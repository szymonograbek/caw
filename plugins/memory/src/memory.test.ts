import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, Layer, Option, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";
import { Conversation, Session } from "@caw/sdk/conversation";
import {
  ChannelName,
  ConversationId,
  ExternalConversationId,
  HarnessName,
  ProfileName,
  SessionId,
} from "@caw/sdk/ids";
import { Interceptor } from "@caw/sdk/interceptors";
import type { CliCommand, PluginMessage } from "@caw/sdk/plugin";
import { Caw, PluginContext } from "@caw/sdk/plugin";
import { Profile } from "@caw/sdk/profile";
import type { Tool, ToolContext } from "@caw/sdk/tool";
import memory from "./index.ts";

interface Registered {
  readonly tools: Array<Tool>;
  readonly interceptors: Array<Interceptor>;
  readonly commands: Array<CliCommand>;
}

/** Starts the plugin as core would: migrations first, then its layer with a fake Caw. */
const startPlugin = Effect.gen(function* () {
  const registered: Registered = { tools: [], interceptors: [], commands: [] };
  const unused = Effect.die("not used by the memory plugin");

  const caw = Layer.succeed(Caw)({
    registerChannel: () => unused,
    registerHarness: () => unused,
    registerTool: (tool) => Effect.sync(() => registered.tools.push(tool)),
    registerInterceptor: (interceptor) =>
      Effect.sync(() => registered.interceptors.push(interceptor)),
    registerCliCommand: (command) => Effect.sync(() => registered.commands.push(command)),
    registerProfiles: () => unused,
    events: Stream.empty,
    bus: yield* PubSub.unbounded<PluginMessage>(),
    conversation: () => unused,
    send: () => unused,
    deliverTask: () => unused,
  });

  const pluginContext = Layer.succeed(PluginContext)({
    name: memory.name,
    get: () => unused,
    set: () => unused,
  });

  yield* Effect.forEach(memory.migrations, (migration) => migration.run);
  yield* Layer.build(memory.layer({}).pipe(Layer.provide(Layer.merge(caw, pluginContext))));

  return registered;
});

const sqlite = SqliteClient.layer({ filename: ":memory:" });

const roomA = ConversationId.make("room-a");

const roomB = ConversationId.make("room-b");

const inRoom = (root: ConversationId): ToolContext => ({
  conversationId: root,
  rootConversationId: root,
  sessionId: SessionId.make("session-1"),
});

const threadOfA: ToolContext = {
  conversationId: ConversationId.make("thread-of-a"),
  rootConversationId: roomA,
  sessionId: SessionId.make("session-2"),
};

const call =
  (registered: Registered, context: ToolContext) =>
  (name: string, input: Record<string, string | number | boolean>) =>
    Array.findFirst(registered.tools, (tool) => tool.name === name).pipe(
      Effect.fromOption,
      Effect.orDie,
      Effect.flatMap((tool) => tool.run(input, context)),
    );

const conversation = (id: ConversationId) =>
  new Conversation({
    id,
    channel: ChannelName.make("discord"),
    externalId: ExternalConversationId.make(`external-${id}`),
    parentId: Option.none(),
    replyMode: "threaded",
    profile: Option.none(),
  });

/** What the plugin adds to the system prompt of a Session opening under `root`. */
const openSession = (registered: Registered, root: ConversationId) =>
  Effect.forEach(registered.interceptors.filter(Interceptor.$is("SessionOpening")), (interceptor) =>
    interceptor.handle({
      conversation: conversation(root),
      root: conversation(root),
      session: new Session({
        id: SessionId.make("session-1"),
        conversationId: root,
        harness: HarnessName.make("claude"),
        profile: ProfileName.make("default"),
        status: "live",
        forkedFrom: Option.none(),
      }),
      profile: new Profile({
        name: ProfileName.make("default"),
        harness: HarnessName.make("claude"),
        env: {},
        model: Option.none(),
        cwd: Option.none(),
        settingSources: Option.none(),
        effort: Option.none(),
      }),
    }),
  ).pipe(Effect.map((contributions) => contributions.flatMap((c) => c.systemPrompt)));

const exportMemories = (registered: Registered, args: ReadonlyArray<string>) =>
  Array.findFirst(registered.commands, (command) => command.name === "memory").pipe(
    Effect.fromOption,
    Effect.orDie,
    Effect.flatMap((command) =>
      command.run(["export", ...args], { conversationId: Option.none(), cwd: "/" }),
    ),
  );

describe("memory tools", () => {
  it.effect("saves, lists titles only, and reads a body", () =>
    Effect.gen(function* () {
      const tool = call(yield* startPlugin, inRoom(roomA));

      const saved = yield* tool("memory_save", {
        scope: "conversation",
        title: "Deploy target",
        body: "Production runs on the hetzner box.",
      });

      const listed = yield* tool("memory_list", {});
      const read = yield* tool("memory_read", { id: 1 });

      expect(saved).toBe("Saved #1 (conversation) Deploy target.");
      expect(listed).toBe("#1 (conversation) Deploy target");
      expect(read).toBe("#1 (conversation) Deploy target\n\nProduction runs on the hetzner box.");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("scopes conversation Memories to the top-level Conversation and its threads", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;
      const inA = call(registered, inRoom(roomA));

      yield* inA("memory_save", { scope: "conversation", title: "A only", body: "a" });
      yield* inA("memory_save", { scope: "global", title: "Everyone", body: "g" });

      const fromThread = yield* call(registered, threadOfA)("memory_list", {});
      const fromB = yield* call(registered, inRoom(roomB))("memory_list", {});

      const readFromB = yield* Effect.flip(
        call(registered, inRoom(roomB))("memory_read", { id: 1 }),
      );

      expect(fromThread).toBe("#2 (global) Everyone\n#1 (conversation) A only");
      expect(fromB).toBe("#2 (global) Everyone");
      expect(readFromB.message).toContain("No Memory #1 is visible here");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("updates and forgets Memories", () =>
    Effect.gen(function* () {
      const tool = call(yield* startPlugin, inRoom(roomA));

      yield* tool("memory_save", { scope: "conversation", title: "Editor", body: "vim" });
      yield* tool("memory_update", { id: 1, body: "helix" });
      const read = yield* tool("memory_read", { id: 1 });
      const forgotten = yield* tool("memory_forget", { id: 1 });
      const listed = yield* tool("memory_list", {});

      expect(read).toBe("#1 (conversation) Editor\n\nhelix");
      expect(forgotten).toBe("Forgot Memory #1.");
      expect(listed).toBe("No Memories yet.");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("rejects a save past 100 Memories in a scope until one is forgotten", () =>
    Effect.gen(function* () {
      const tool = call(yield* startPlugin, inRoom(roomA));

      yield* Effect.forEach(Array.range(1, 100), (n) =>
        tool("memory_save", { scope: "conversation", title: `Fact ${n}`, body: "x" }),
      );

      const rejected = yield* Effect.flip(
        tool("memory_save", { scope: "conversation", title: "One more", body: "x" }),
      );

      const otherScope = yield* tool("memory_save", { scope: "global", title: "Fine", body: "x" });
      yield* tool("memory_forget", { id: 1 });

      const afterForget = yield* tool("memory_save", {
        scope: "conversation",
        title: "One more",
        body: "x",
      });

      expect(rejected.message).toBe(
        "This Conversation already holds 100 Memories, the cap. Merge related Memories with memory_update or remove stale ones with memory_forget, then save again.",
      );
      expect(otherScope).toBe("Saved #101 (global) Fine.");
      expect(afterForget).toBe("Saved #102 (conversation) One more.");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("rejects bodies over 1000 characters on save and update", () =>
    Effect.gen(function* () {
      const tool = call(yield* startPlugin, inRoom(roomA));
      const long = "x".repeat(1001);

      const onSave = yield* Effect.flip(
        tool("memory_save", { scope: "global", title: "Long", body: long }),
      );

      yield* tool("memory_save", { scope: "global", title: "Short", body: "x".repeat(1000) });
      const onUpdate = yield* Effect.flip(tool("memory_update", { id: 1, body: long }));

      expect(onSave.message).toContain("The body is 1001 characters; the cap is 1000.");
      expect(onUpdate.message).toContain("The body is 1001 characters; the cap is 1000.");
    }).pipe(Effect.provide(sqlite)),
  );
});

describe("pinned Memories at SessionOpening", () => {
  it.effect("injects pinned global and root Memories in a stable order", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;
      const inA = call(registered, inRoom(roomA));
      const inB = call(registered, inRoom(roomB));

      yield* inA("memory_save", {
        scope: "conversation",
        title: "A pinned",
        body: "a",
        pinned: true,
      });
      yield* inA("memory_save", { scope: "conversation", title: "A loose", body: "b" });
      yield* inB("memory_save", {
        scope: "conversation",
        title: "B pinned",
        body: "c",
        pinned: true,
      });
      yield* inB("memory_save", { scope: "global", title: "Shared", body: "d" });
      yield* inA("memory_pin", { id: 4, pinned: true });

      const promptA = yield* openSession(registered, roomA);
      const promptAgain = yield* openSession(registered, roomA);

      expect(promptA).toEqual([
        [
          "<pinned-memories>\nYour pinned Memories. memory_list shows all of them.",
          "#4 (global) Shared\nd",
          "#1 (conversation) A pinned\na",
          "</pinned-memories>",
        ].join("\n\n"),
      ]);
      expect(promptAgain).toEqual(promptA);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("adds nothing when no Memory is pinned", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      yield* call(registered, inRoom(roomA))("memory_save", {
        scope: "conversation",
        title: "Loose",
        body: "x",
      });

      expect(yield* openSession(registered, roomA)).toEqual([]);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("keeps the pinned section within its 2000-character budget", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;
      const tool = call(registered, inRoom(roomA));

      yield* Effect.forEach(Array.range(1, 4), (n) =>
        tool("memory_save", {
          scope: "conversation",
          title: `Big ${n}`,
          body: "x".repeat(500),
          pinned: true,
        }),
      );
      const unpinned = yield* tool("memory_pin", { id: 4, pinned: false });
      const repinned = yield* tool("memory_pin", { id: 4, pinned: true });
      const [section = ""] = yield* openSession(registered, roomA);

      expect(section.length).toBeLessThanOrEqual(2000);
      expect(section).toContain("#3 (conversation) Big 3");
      expect(section).not.toContain("Big 4");
      expect(section).toContain("1 more pinned Memories did not fit");
      expect(unpinned).toBe("Unpinned #4 (conversation) Big 4.");
      expect(repinned).toContain("1 pinned Memories no longer fit the 2000-character budget");
    }).pipe(Effect.provide(sqlite)),
  );
});

describe("caw memory export", () => {
  it.effect("prints every Memory as markdown with its dates", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      yield* TestClock.setTime(Date.UTC(2026, 10, 20));
      yield* call(registered, inRoom(roomA))("memory_save", {
        scope: "conversation",
        title: "Editor",
        body: "helix",
        pinned: true,
      });
      yield* call(registered, inRoom(roomB))("memory_save", {
        scope: "global",
        title: "Name",
        body: "Call me Sam.",
      });
      yield* TestClock.adjust("2 days");
      yield* call(registered, inRoom(roomA))("memory_read", { id: 1 });

      const markdown = yield* exportMemories(registered, []);

      expect(markdown).toBe(
        [
          "# Caw Memories",
          "## Global",
          "### Name",
          "Call me Sam.",
          "_#2 · saved 2026-11-20 · last used 2026-11-20_",
          "## Conversation room-a",
          "### Editor (pinned)",
          "helix",
          "_#1 · saved 2026-11-20 · last used 2026-11-22_",
        ].join("\n\n"),
      );
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("writes the markdown to an absolute --out path", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "caw-memory-")));
      const out = join(directory, "memories.md");

      const printed = yield* exportMemories(registered, ["--out", out]);
      const written = yield* Effect.promise(() => Bun.file(out).text());
      yield* Effect.promise(() => rm(directory, { recursive: true }));

      expect(printed).toBe(`Exported 0 Memories to ${out}.`);
      expect(written).toBe("# Caw Memories\n\nNo Memories.\n");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("requires an absolute --out path", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      const error = yield* Effect.flip(exportMemories(registered, ["--out", "memories.md"]));

      expect(error.message).toContain("--out must be an absolute path");
    }).pipe(Effect.provide(sqlite)),
  );
});
