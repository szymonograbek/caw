import { describe, expect, it } from "@effect/vitest";
import { ConversationPlace } from "@omen/sdk/channel";
import { HarnessError, HarnessEvent, SessionStart } from "@omen/sdk/harness";
import { ChannelName, ExternalConversationId, ProfileName } from "@omen/sdk/ids";
import { Effect, Layer, Option, Queue, Ref } from "effect";
import { Conversations } from "../store/conversations.ts";
import { Sessions } from "../store/sessions.ts";
import { makeFakeChannel } from "../testing/fake-channel.ts";
import type { FakeSession } from "../testing/fake-harness.ts";
import { makeFakeHarness } from "../testing/fake-harness.ts";
import {
  eventually,
  message,
  startPlugins,
  temporaryHome,
  testCoreLayer,
  thread,
} from "../testing/test-daemon.ts";
import { ConversationPlaces } from "./conversation-places.ts";
import { Router } from "./router.ts";

const daemon = Layer.unwrap(Effect.map(temporaryHome, (home) => testCoreLayer(home)));

const dm = ConversationPlace.Direct();

const setup = Effect.gen(function* () {
  const channel = yield* makeFakeChannel;
  const harness = yield* makeFakeHarness;

  yield* startPlugins(channel, harness);

  const sessionAt = (index: number) =>
    Effect.flatMap(Ref.get(harness.sessions), (all) => {
      const session = all[index];

      return session === undefined ? Effect.die(`no session ${index}`) : Effect.succeed(session);
    });

  const sentCount = (count: number) =>
    eventually(Effect.map(Ref.get(channel.sent), (sent) => sent.length >= count));

  const sessionCount = (count: number) =>
    eventually(Effect.map(Ref.get(harness.sessions), (all) => all.length >= count));

  const inputCount = (index: number, count: number) =>
    eventually(
      Effect.flatMap(Ref.get(harness.sessions), (all) =>
        Effect.map(
          Ref.get(all[index]?.inputs ?? Ref.makeUnsafe<ReadonlyArray<string>>([])),
          (inputs) => inputs.length >= count,
        ),
      ),
    );

  return { channel, harness, sessionAt, sentCount, sessionCount, inputCount };
});

const inputsOf = (session: FakeSession) => Ref.get(session.inputs);

const conversationOf = (externalId: string) =>
  Conversations.use((conversations) =>
    conversations
      .find(ChannelName.make("fake"), ExternalConversationId.make(externalId))
      .pipe(Effect.flatMap(Effect.fromOption)),
  );

describe("Router", () => {
  it.effect("answers a Room message in a new thread with a new Session", () =>
    Effect.gen(function* () {
      const { channel, sessionAt, sentCount } = yield* setup;

      yield* channel.say(message("room", "m1", "hello there"));
      yield* sentCount(1);

      expect(yield* Ref.get(channel.threads)).toEqual([{ from: "m1", name: "hello there" }]);
      expect(yield* Ref.get(channel.sent)).toEqual([
        { conversation: "thread-m1", text: "reply 1" },
      ]);

      const session = yield* sessionAt(0);

      expect(session.request.start._tag).toBe("New");
      expect(session.request.env["OMEN_SESSION_ID"]).toBe(session.request.sessionId);
      expect(session.request.env["FROM_ENV"]).toBe("1");
      expect(session.request.rootConversationId).not.toBe(session.request.conversationId);
      expect(yield* inputsOf(session)).toEqual([
        expect.stringContaining('<message id="m1" sender="Ada"'),
      ]);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("keeps one Session for an inline Conversation", () =>
    Effect.gen(function* () {
      const { channel, harness, sessionAt, sentCount } = yield* setup;

      yield* channel.say(message("dm", "m1", "one", dm));
      yield* sentCount(1);
      yield* channel.say(message("dm", "m2", "two", dm));
      yield* sentCount(2);

      expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
      const session = yield* sessionAt(0);

      expect(yield* inputsOf(session)).toHaveLength(2);
      expect(yield* Ref.get(channel.sent)).toEqual([
        { conversation: "dm", text: "reply 1" },
        { conversation: "dm", text: "reply 2" },
      ]);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("Forks the inline Session when a person opens a thread off it", () =>
    Effect.gen(function* () {
      const { channel, sessionAt, sentCount, sessionCount } = yield* setup;
      const places = yield* ConversationPlaces;
      const conversations = yield* Conversations;
      const sessions = yield* Sessions;

      const roomConversation = yield* places.resolve(
        ChannelName.make("fake"),
        ExternalConversationId.make("room"),
        ConversationPlace.Room(),
      );

      yield* conversations.setReplyMode(roomConversation.id, "inline");
      yield* channel.say(message("room", "m1", "main"));
      yield* sentCount(1);
      yield* eventually(
        Effect.map(sessions.current(roomConversation.id), (stored) =>
          Option.exists(stored, (s) => Option.isSome(s.cursor)),
        ),
      );
      yield* channel.say(message("t1", "m2", "side question", thread("room")));
      yield* sessionCount(2);

      const main = yield* sessionAt(0);
      const fork = yield* sessionAt(1);

      expect(yield* Ref.get(channel.threads)).toEqual([]);
      expect(fork.request.start).toEqual(SessionStart.Fork({ cursor: main.request.sessionId }));
      expect(fork.request.rootConversationId).toBe(roomConversation.id);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("Steers a running Turn instead of starting another", () =>
    Effect.gen(function* () {
      const { channel, harness, sessionAt, inputCount } = yield* setup;

      yield* Ref.set(harness.manual, true);
      yield* channel.say(message("dm", "m1", "start", dm));
      yield* inputCount(0, 1);
      yield* channel.say(message("dm", "m2", "also this", dm));
      yield* inputCount(0, 2);

      const session = yield* sessionAt(0);

      expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
      expect(yield* inputsOf(session)).toEqual([
        expect.stringContaining('id="m1"'),
        expect.stringContaining('id="m2"'),
      ]);
      expect(yield* Ref.get(channel.typing)).toBe(1);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("/new starts a new Session for the Conversation", () =>
    Effect.gen(function* () {
      const { channel, harness, sentCount, sessionCount } = yield* setup;
      const sessions = yield* Sessions;

      yield* channel.say(message("dm", "m1", "one", dm));
      yield* sentCount(1);

      const first = (yield* conversationOf("dm")).id;
      const before = yield* sessions.current(first);

      yield* channel.command("dm", dm, "new");
      yield* eventually(Effect.map(Ref.get(channel.responses), (all) => all.length === 1));
      yield* channel.say(message("dm", "m2", "two", dm));
      yield* sessionCount(2);

      expect(yield* Ref.get(channel.responses)).toEqual(["Started a new session."]);
      expect(yield* Ref.get(harness.sessions)).toHaveLength(2);

      const closed = yield* sessions.get(Option.getOrThrow(before).session.id);

      expect(Option.map(closed, (s) => s.session.status)).toEqual(Option.some("closed"));
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("/stop interrupts the Turn and reacts ⏹️ on its messages", () =>
    Effect.gen(function* () {
      const { channel, harness, sessionAt, inputCount } = yield* setup;

      yield* Ref.set(harness.manual, true);
      yield* channel.say(message("dm", "m1", "long job", dm));
      yield* inputCount(0, 1);
      yield* channel.command("dm", dm, "stop");
      yield* eventually(Effect.map(Ref.get(channel.reactions), (all) => all.length === 1));

      const session = yield* sessionAt(0);

      expect(yield* Ref.get(session.interrupts)).toBe(1);
      expect(yield* Ref.get(channel.reactions)).toEqual([
        { conversation: "dm", message: "m1", emoji: "⏹️" },
      ]);
      expect(yield* Ref.get(channel.responses)).toEqual(["Stopped."]);
      expect(yield* Ref.get(channel.typing)).toBe(0);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("reacts ❌ and replies with the error when a Turn fails", () =>
    Effect.gen(function* () {
      const { channel, harness, sessionAt, inputCount, sentCount } = yield* setup;

      yield* Ref.set(harness.manual, true);
      yield* channel.say(message("dm", "m1", "do it", dm));
      yield* inputCount(0, 1);

      const session = yield* sessionAt(0);

      yield* Queue.offer(
        session.events,
        HarnessEvent.Failed({
          error: new HarnessError({ harness: "fake", message: "model overloaded", cause: null }),
        }),
      );
      yield* sentCount(1);

      expect(yield* Ref.get(channel.reactions)).toEqual([
        { conversation: "dm", message: "m1", emoji: "❌" },
      ]);
      expect(yield* Ref.get(channel.sent)).toEqual([
        { conversation: "dm", text: "❌ The Turn failed: model overloaded" },
      ]);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("starts a new Session when the Conversation's profile changes", () =>
    Effect.gen(function* () {
      const { channel, harness, sentCount, sessionCount, sessionAt } = yield* setup;
      const conversations = yield* Conversations;
      const sessions = yield* Sessions;

      yield* channel.say(message("dm", "m1", "one", dm));
      yield* sentCount(1);

      const conversation = yield* conversationOf("dm");
      const first = Option.getOrThrow(yield* sessions.current(conversation.id));

      yield* conversations.setProfile(conversation.id, Option.some(ProfileName.make("work")));
      yield* channel.say(message("dm", "m2", "two", dm));
      yield* sessionCount(2);

      const second = yield* sessionAt(1);

      expect(yield* Ref.get(harness.sessions)).toHaveLength(2);
      expect(second.request.start._tag).toBe("New");
      expect(second.request.profile.name).toBe("work");
      expect(second.request.env["PROFILE"]).toBe("work");

      const closed = yield* sessions.get(first.session.id);

      expect(Option.map(closed, (s) => s.session.status)).toEqual(Option.some("closed"));
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );

  it.effect("delivers a scheduled task into a new thread of a threaded Room", () =>
    Effect.gen(function* () {
      const { channel, sessionAt, sessionCount, inputCount } = yield* setup;
      const places = yield* ConversationPlaces;
      const router = yield* Router;

      const roomConversation = yield* places.resolve(
        ChannelName.make("fake"),
        ExternalConversationId.make("room"),
        ConversationPlace.Room(),
      );

      yield* router.deliverTask(roomConversation.id, "Water the plants");
      yield* sessionCount(1);
      yield* inputCount(0, 1);

      const session = yield* sessionAt(0);

      expect(yield* Ref.get(channel.threads)).toEqual([
        { from: "sent-1", name: "Water the plants" },
      ]);
      expect((yield* Ref.get(channel.sent))[0]).toEqual({
        conversation: "room",
        text: "⏰ Scheduled task",
      });
      expect(yield* inputsOf(session)).toEqual([
        expect.stringMatching(
          /^<context timezone="Europe\/Warsaw"\/>\n<task current_time="[^"]+">Water the plants<\/task>$/,
        ),
      ]);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );
});
