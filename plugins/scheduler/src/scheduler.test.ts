import { SqliteClient } from "@effect/sql-sqlite-bun";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, Exit, Layer, Option, PubSub, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { Conversation } from "@gloaming/sdk/conversation";
import { ChannelName, ConversationId, ExternalConversationId } from "@gloaming/sdk/ids";
import type { CliCommand, CliContext, PluginMessage } from "@gloaming/sdk/plugin";
import { ConversationNotFound, Caw, PluginContext } from "@gloaming/sdk/plugin";
import scheduler from "./index.ts";

interface Delivery {
  readonly conversationId: ConversationId;
  readonly prompt: string;
}

/** What the fake core saw, across plugin restarts. */
interface Core {
  readonly deliveries: Array<Delivery>;
  readonly commands: Array<CliCommand>;
  readonly conversations: Set<string>;
  /** Each thread's parent Conversation. */
  readonly threads: Map<string, ConversationId>;
}

const room = ConversationId.make("room-1");

const conversationRecord = (core: Core, id: ConversationId) =>
  new Conversation({
    id,
    channel: ChannelName.make("discord"),
    externalId: ExternalConversationId.make(`external-${id}`),
    parentId: Option.fromNullishOr(core.threads.get(id)),
    replyMode: "threaded",
    profile: Option.none(),
  });

const lookupIn = (core: Core) => (id: ConversationId) =>
  core.conversations.has(id)
    ? Effect.succeed(conversationRecord(core, id))
    : Effect.fail(new ConversationNotFound({ conversationId: id }));

const makeCore = (): Core => ({
  deliveries: [],
  commands: [],
  conversations: new Set([room]),
  threads: new Map(),
});

/** Starts the plugin in its own scope, as core does when it enables it; close the scope to stop it. */
const startPlugin = (core: Core) =>
  Effect.gen(function* () {
    const unused = Effect.die("not used by the scheduler plugin");
    const known = lookupIn(core);

    const caw = Layer.succeed(Caw)({
      registerChannel: () => unused,
      registerHarness: () => unused,
      registerTool: () => unused,
      registerInterceptor: () => unused,
      registerCliCommand: (command) => Effect.sync(() => core.commands.splice(0, 1, command)),
      registerProfiles: () => unused,
      events: Stream.empty,
      bus: yield* PubSub.unbounded<PluginMessage>(),
      conversation: known,
      send: () => unused,
      deliverTask: (conversationId, prompt) =>
        known(conversationId).pipe(
          Effect.andThen(Effect.sync(() => core.deliveries.push({ conversationId, prompt }))),
        ),
    });

    const pluginContext = Layer.succeed(PluginContext)({
      name: scheduler.name,
      get: () => unused,
      set: () => unused,
    });

    const scope = yield* Scope.make();

    yield* Effect.forEach(scheduler.migrations, (migration) => migration.run);
    yield* Layer.buildWithScope(
      scheduler.layer({}).pipe(Layer.provide(Layer.merge(caw, pluginContext))),
      scope,
    );

    return { stop: Scope.close(scope, Exit.void) };
  });

const inRoom: CliContext = { conversationId: Option.some(room), cwd: "/" };

const thread = ConversationId.make("room-1-thread");

const inThread: CliContext = { conversationId: Option.some(thread), cwd: "/" };

/** Adds a thread of `room` to the fake core. */
const openThread = (core: Core) => {
  core.conversations.add(thread);
  core.threads.set(thread, room);
};

const outside: CliContext = { conversationId: Option.none(), cwd: "/" };

const schedule = (core: Core, args: ReadonlyArray<string>, context: CliContext = inRoom) =>
  Array.head(core.commands).pipe(
    Effect.fromOption,
    Effect.orDie,
    Effect.flatMap((command) => command.run(args, context)),
  );

/** Moves the clock and lets the runner fiber act on it. */
const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
  TestClock.adjust(duration).pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(Effect.yieldNow));

const sqlite = SqliteClient.layer({ filename: ":memory:" });

const nov20At8 = Date.UTC(2026, 10, 20, 8);

describe("scheduler runner", () => {
  it.effect("delivers a cron Schedule at every match", () =>
    Effect.gen(function* () {
      const core = makeCore();

      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);

      const added = yield* schedule(core, [
        "add",
        "--cron",
        "0 9 * * *",
        "--timezone",
        "UTC",
        "--prompt",
        "Post the standup summary.",
      ]);

      yield* advance("59 minutes");
      const beforeNine = core.deliveries.length;
      yield* advance("1 minute");
      const atNine = core.deliveries.length;
      yield* advance("1 day");

      expect(added).toBe(
        "Added Schedule #1 for Conversation room-1; next run 2026-11-20T09:00:00.000+00:00[UTC].",
      );
      expect(beforeNine).toBe(0);
      expect(atNine).toBe(1);
      expect(core.deliveries).toEqual([
        { conversationId: room, prompt: "Post the standup summary." },
        { conversationId: room, prompt: "Post the standup summary." },
      ]);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("delivers a one-off Schedule once, read in its time zone, then removes it", () =>
    Effect.gen(function* () {
      const core = makeCore();

      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);
      yield* schedule(core, [
        "add",
        "--at",
        "2026-11-20T10:00",
        "--timezone",
        "Europe/Warsaw",
        "--prompt",
        "Remind me to call the bank.",
      ]);
      const listed = yield* schedule(core, ["list"]);
      yield* advance("59 minutes");
      const early = core.deliveries.length;
      yield* advance("1 minute");
      yield* advance("2 days");
      const afterwards = yield* schedule(core, ["list"]);

      expect(listed).toBe(
        "#1  once  next 2026-11-20T10:00:00.000+01:00[Europe/Warsaw]  conversation room-1\n    Remind me to call the bank.",
      );
      expect(early).toBe(0);
      expect(core.deliveries).toEqual([
        { conversationId: room, prompt: "Remind me to call the bank." },
      ]);
      expect(afterwards).toBe("No Schedules.");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("wakes for a Schedule added while it sleeps until a later one", () =>
    Effect.gen(function* () {
      const core = makeCore();

      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);
      yield* schedule(core, ["add", "--at", "2026-11-21T08:00Z", "--prompt", "later"]);
      yield* schedule(core, ["add", "--at", "2026-11-20T08:30Z", "--prompt", "sooner"]);
      yield* advance("30 minutes");

      expect(core.deliveries).toEqual([{ conversationId: room, prompt: "sooner" }]);
    }).pipe(Effect.provide(sqlite)),
  );
});

describe("missed runs at startup", () => {
  it.effect("catches up once when the latest missed run is within 24h, then moves on", () =>
    Effect.gen(function* () {
      const core = makeCore();

      yield* TestClock.setTime(nov20At8);
      const first = yield* startPlugin(core);
      yield* schedule(core, [
        "add",
        "--cron",
        "0 9 * * *",
        "--timezone",
        "UTC",
        "--prompt",
        "daily",
      ]);
      yield* first.stop;

      // Down for three 09:00 runs; the latest was 22h before the restart.
      yield* TestClock.setTime(Date.UTC(2026, 10, 23, 7));
      yield* startPlugin(core);
      yield* advance("1 millis");
      const caughtUp = core.deliveries.length;
      const listed = yield* schedule(core, ["list"]);

      expect(caughtUp).toBe(1);
      expect(listed).toContain("next 2026-11-23T09:00:00.000+00:00[UTC]");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("skips runs missed by more than 24h and removes a finished one-off", () =>
    Effect.gen(function* () {
      const core = makeCore();

      yield* TestClock.setTime(nov20At8);
      const first = yield* startPlugin(core);
      yield* schedule(core, ["add", "--at", "2026-11-20T09:00Z", "--prompt", "once"]);
      yield* schedule(core, [
        "add",
        "--cron",
        "0 9 * * 1",
        "--timezone",
        "UTC",
        "--prompt",
        "mondays",
      ]);
      yield* first.stop;

      // Monday 2026-11-23 09:00 was missed 25h before the restart.
      yield* TestClock.setTime(Date.UTC(2026, 10, 24, 10));
      yield* startPlugin(core);
      yield* advance("1 millis");
      const listed = yield* schedule(core, ["list"]);

      expect(core.deliveries).toEqual([]);
      expect(listed).toBe(
        '#2  cron "0 9 * * 1" (UTC)  next 2026-11-30T09:00:00.000+00:00[UTC]  conversation room-1\n    mondays',
      );
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("removes a Schedule whose Conversation no longer exists when it fires", () =>
    Effect.gen(function* () {
      const core = makeCore();

      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);
      yield* schedule(core, ["add", "--cron", "0 9 * * *", "--timezone", "UTC", "--prompt", "x"]);
      core.conversations.delete(room);
      yield* advance("1 hour");
      const listed = yield* schedule(core, ["list", "--all"]);

      expect(core.deliveries).toEqual([]);
      expect(listed).toBe("No Schedules.");
    }).pipe(Effect.provide(sqlite)),
  );
});

describe("caw schedule", () => {
  it.effect("targets --conversation over CAW_CONVERSATION_ID, and lists by Conversation", () =>
    Effect.gen(function* () {
      const core = makeCore();
      const other = ConversationId.make("room-2");

      core.conversations.add(other);
      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);
      yield* schedule(core, ["add", "--at", "2026-11-21T08:00Z", "--prompt", "mine"]);
      yield* schedule(core, [
        "add",
        "--at",
        "2026-11-21T09:00Z",
        "--prompt",
        "theirs",
        "--conversation",
        "room-2",
      ]);
      const mine = yield* schedule(core, ["list"]);
      const all = yield* schedule(core, ["list", "--all"], outside);

      expect(mine).toContain("mine");
      expect(mine).not.toContain("theirs");
      expect(all).toContain("mine");
      expect(all).toContain("conversation room-2");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect(
    "targets the top-level Conversation from a thread unless --conversation says otherwise",
    () =>
      Effect.gen(function* () {
        const core = makeCore();

        openThread(core);
        yield* TestClock.setTime(nov20At8);
        yield* startPlugin(core);

        const added = yield* schedule(
          core,
          ["add", "--at", "2026-11-20T09:00Z", "--prompt", "main"],
          inThread,
        );

        yield* schedule(
          core,
          ["add", "--at", "2026-11-20T09:30Z", "--prompt", "here", "--conversation", thread],
          inThread,
        );
        yield* advance("2 hours");

        expect(added).toContain("for Conversation room-1;");
        expect(core.deliveries).toEqual([
          { conversationId: room, prompt: "main" },
          { conversationId: thread, prompt: "here" },
        ]);
      }).pipe(Effect.provide(sqlite)),
  );

  it.effect("lists the top-level Conversation's and its threads' Schedules from either", () =>
    Effect.gen(function* () {
      const core = makeCore();
      const other = ConversationId.make("room-2");

      openThread(core);
      core.conversations.add(other);
      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);
      yield* schedule(core, ["add", "--at", "2026-11-21T08:00Z", "--prompt", "main"]);
      yield* schedule(core, [
        "add",
        "--at",
        "2026-11-21T09:00Z",
        "--prompt",
        "thread",
        "--conversation",
        thread,
      ]);
      yield* schedule(core, [
        "add",
        "--at",
        "2026-11-21T10:00Z",
        "--prompt",
        "theirs",
        "--conversation",
        other,
      ]);
      const fromMain = yield* schedule(core, ["list"]);
      const fromThread = yield* schedule(core, ["list"], inThread);
      const onlyThread = yield* schedule(core, ["list", "--conversation", thread]);

      expect(fromMain).toContain("main");
      expect(fromMain).toContain("conversation room-1-thread");
      expect(fromMain).not.toContain("theirs");
      expect(fromThread).toBe(fromMain);
      expect(onlyThread).not.toContain("main");
      expect(onlyThread).toContain("thread");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("removes a Schedule by id", () =>
    Effect.gen(function* () {
      const core = makeCore();

      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);
      yield* schedule(core, ["add", "--at", "2026-11-20T09:00Z", "--prompt", "x"]);
      const removed = yield* schedule(core, ["remove", "1"]);
      const again = yield* Effect.flip(schedule(core, ["remove", "1"]));
      yield* advance("2 hours");

      expect(removed).toBe("Removed Schedule #1.");
      expect(again.message).toBe("No Schedule #1.");
      expect(core.deliveries).toEqual([]);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("rejects invalid Schedules with a reason", () =>
    Effect.gen(function* () {
      const core = makeCore();
      const every = ["--cron", "* * * * *", "--prompt", "x"];

      const cases: ReadonlyArray<readonly [ReadonlyArray<string>, CliContext, string]> = [
        [["add", "--prompt", "x"], inRoom, "Pass exactly one of --cron or --at."],
        [
          ["add", ...every, "--at", "2026-11-21T08:00Z"],
          inRoom,
          "Pass exactly one of --cron or --at.",
        ],
        [
          ["add", "--cron", "every day", "--prompt", "x"],
          inRoom,
          "Invalid --cron: Invalid number of segments in cron expression",
        ],
        [
          ["add", "--at", "2026-11-19T08:00Z", "--prompt", "x"],
          inRoom,
          "--at 2026-11-19T08:00Z is in the past.",
        ],
        [["add", ...every, "--timezone", "Mars/Base"], inRoom, "Unknown --timezone Mars/Base."],
        [
          ["add", ...every],
          outside,
          "Pass --conversation <id>; there is no CAW_CONVERSATION_ID here.",
        ],
        [["add", ...every, "--conversation", "nope"], inRoom, "No Conversation nope."],
        [
          ["list"],
          outside,
          "Pass --all or --conversation <id>; there is no CAW_CONVERSATION_ID here.",
        ],
      ];

      yield* TestClock.setTime(nov20At8);
      yield* startPlugin(core);

      const messages = yield* Effect.forEach(cases, ([args, context]) =>
        schedule(core, args, context).pipe(
          Effect.flip,
          Effect.map((error) => error.message),
        ),
      );

      expect(messages).toEqual(cases.map(([, , message]) => message));
    }).pipe(Effect.provide(sqlite)),
  );
});
