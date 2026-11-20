import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { ConversationPlace } from "@gloaming/sdk/channel";
import { ChannelName, ConversationId, ExternalConversationId } from "@gloaming/sdk/ids";
import { Effect, Exit, Layer, Option, Ref } from "effect";
import { writeAgentFiles } from "../home/agent-files.ts";
import { CawHome } from "../home/caw-home.ts";
import { DaemonLifecycle } from "../rpc/daemon-lifecycle.ts";
import { CawClient } from "../rpc/rpc-client.ts";
import { rpcServerLayer } from "../rpc/rpc-server.ts";
import { Conversations } from "../store/conversations.ts";
import { makeFakeChannel } from "../testing/fake-channel.ts";
import { makeFakeHarness } from "../testing/fake-harness.ts";
import {
  eventually,
  message,
  startPlugins,
  temporaryHome,
  testCoreLayer,
  thread,
} from "../testing/test-daemon.ts";

const server = Layer.unwrap(
  Effect.map(temporaryHome, (home) =>
    rpcServerLayer.pipe(
      Layer.provideMerge(Layer.merge(testCoreLayer(home), DaemonLifecycle.layer)),
    ),
  ),
);

/** `caw <argv>` through the daemon socket, as the CLI sends it. */
const caw = (argv: ReadonlyArray<string>, conversationId = Option.none<string>()) =>
  Effect.gen(function* () {
    const home = yield* CawHome;

    return yield* CawClient.use((client) =>
      client.RunCommand({
        argv,
        conversationId: Option.map(conversationId, (id) => ConversationId.make(id)),
        cwd: "/",
      }),
    ).pipe(Effect.provide(CawClient.layer(home.socket)));
  });

const failure = (text: string) => Exit.fail(expect.objectContaining({ message: text }));

describe("core CLI commands", () => {
  it.live("list, disable, order and configure Plugins", () =>
    Effect.gen(function* () {
      const channel = yield* makeFakeChannel;
      const harness = yield* makeFakeHarness;

      yield* startPlugins(channel, harness);
      yield* DaemonLifecycle.use((daemon) => daemon.markReady);

      expect(yield* caw(["plugin", "list"])).toBe("fake  running  (built in)");
      expect(yield* caw(["plugin", "disable", "fake"])).toContain("Disabled plugin fake.");
      expect(yield* caw(["plugin", "list"])).toBe("fake  disabled  (built in)");
      expect(yield* caw(["plugin", "enable", "fake"])).toContain("Enabled plugin fake.");
      expect(yield* caw(["plugin", "set", "fake", "mood=calm", "level=3"])).toContain(
        "Updated settings of fake.",
      );
      expect(yield* caw(["plugin", "order", "fake"])).toBe("Plugin order: fake");

      expect(yield* Effect.exit(caw(["plugin", "remove", "fake"]))).toEqual(
        failure("fake is built in; disable it instead: caw plugin disable fake"),
      );
      expect(yield* Effect.exit(caw(["plugin", "enable", "ghost"]))).toEqual(
        failure("No plugin named ghost. Run `caw plugin list`."),
      );
    }).pipe(Effect.provide(server), Effect.scoped),
  );

  it.effect("shows and changes the Conversation the invoking Session runs in", () =>
    Effect.gen(function* () {
      const channel = yield* makeFakeChannel;
      const harness = yield* makeFakeHarness;

      yield* startPlugins(channel, harness);
      yield* DaemonLifecycle.use((daemon) => daemon.markReady);
      yield* channel.say(message("room", "m1", "hello"));
      yield* eventually(Effect.map(Ref.get(channel.sent), (sent) => sent.length === 1));

      const room = yield* Conversations.use((all) =>
        all.find(ChannelName.make("fake"), ExternalConversationId.make("room")),
      ).pipe(Effect.flatMap(Effect.fromOption));

      const threadConversation = yield* Conversations.use((all) =>
        all.find(ChannelName.make("fake"), ExternalConversationId.make("thread-m1")),
      ).pipe(Effect.flatMap(Effect.fromOption));

      const inThread = Option.some(threadConversation.id);

      expect(yield* Effect.exit(caw(["conversation", "show"]))).toEqual(
        failure("Pass --conversation <id>; there is no CAW_CONVERSATION_ID here."),
      );

      const shown = yield* caw(["conversation", "show"], inThread);

      expect(shown).toContain(`Thread of ${room.id} (fake room)`);
      expect(shown).toContain("Reply mode: threaded");
      expect(shown).toContain("Profile: default (not set)");
      expect(shown).toMatch(/Session: \S+ \(live, profile default\)/);

      expect(
        yield* caw(
          ["conversation", "set", "--profile", "fast", "--reply-mode", "inline"],
          inThread,
        ),
      ).toBe(
        [
          `Profile of ${room.id} is now fast; its next message starts a new Session.`,
          `Reply mode of ${room.id} is now inline.`,
        ].join("\n"),
      );

      // The thread's next message starts a new Session bound to the new profile.
      yield* channel.say(message("thread-m1", "m2", "again", thread("room")));
      yield* eventually(Effect.map(Ref.get(harness.sessions), (all) => all.length === 2));

      const after = yield* caw(["conversation", "show", "--conversation", room.id]);

      expect(after).toContain("Reply mode: inline");
      expect(after).toContain("Profile: fast");

      const [, second] = yield* Ref.get(harness.sessions);

      expect(second?.request.profile.name).toBe("fast");
    }).pipe(Effect.provide(server), Effect.scoped),
  );

  it.effect("writes the core skill and the caw shim into each Session's environment", () =>
    Effect.gen(function* () {
      const channel = yield* makeFakeChannel;
      const harness = yield* makeFakeHarness;
      const home = yield* CawHome;

      yield* writeAgentFiles(["/opt/caw/bin/caw"]);
      yield* startPlugins(channel, harness);
      yield* DaemonLifecycle.use((daemon) => daemon.markReady);
      yield* channel.say(message("dm", "m1", "hi", ConversationPlace.Direct()));
      yield* eventually(Effect.map(Ref.get(harness.sessions), (all) => all.length === 1));

      const [session] = yield* Ref.get(harness.sessions);

      expect(session?.request.env["PATH"]?.split(":")[0]).toBe(home.binDir);
      expect(session?.request.skillDirs[0]).toBe(home.skillDir);

      const shim = yield* Effect.promise(() => Bun.file(NodePath.join(home.binDir, "caw")).text());

      const skill = yield* Effect.promise(() =>
        Bun.file(NodePath.join(home.skillDir, "skills", "caw", "SKILL.md")).text(),
      );

      expect(shim).toContain(`exec '/opt/caw/bin/caw' "$@"`);
      expect(skill).toContain("Run `caw guide`");
    }).pipe(Effect.provide(server), Effect.scoped),
  );
});
