import { describe, expect, it } from "@effect/vitest";
import { ConversationPlace } from "@omen/sdk/channel";
import { HarnessEvent, SessionStart } from "@omen/sdk/harness";
import { ChannelName, ExternalConversationId } from "@omen/sdk/ids";
import { Effect, Layer, Option, Queue, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Conversations } from "../store/conversations.ts";
import { Sessions } from "../store/sessions.ts";
import { makeFakeChannel } from "../testing/fake-channel.ts";
import { makeFakeHarness } from "../testing/fake-harness.ts";
import {
  eventually,
  message,
  startPlugins,
  temporaryHome,
  testConfig,
  testCoreLayer,
} from "../testing/test-daemon.ts";
import { SessionPool } from "./session-pool.ts";

const daemonWith = (config: typeof testConfig) =>
  Layer.unwrap(Effect.map(temporaryHome, (home) => testCoreLayer(home, config)));

const dm = ConversationPlace.Direct();

const setup = Effect.gen(function* () {
  const channel = yield* makeFakeChannel;
  const harness = yield* makeFakeHarness;

  yield* startPlugins(channel, harness);

  const sentCount = (count: number) =>
    eventually(Effect.map(Ref.get(channel.sent), (sent) => sent.length >= count));

  const sessionCount = (count: number) =>
    eventually(Effect.map(Ref.get(harness.sessions), (all) => all.length >= count));

  const closedCount = (count: number) =>
    eventually(
      Effect.flatMap(Ref.get(harness.sessions), (all) =>
        Effect.map(
          Effect.forEach(all, (session) => Ref.get(session.closed)),
          (closed) => closed.filter(Boolean).length >= count,
        ),
      ),
    );

  return { channel, harness, sentCount, sessionCount, closedCount };
});

const currentSession = (externalId: string) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const sessions = yield* Sessions;

    const conversation = yield* conversations
      .find(ChannelName.make("fake"), ExternalConversationId.make(externalId))
      .pipe(Effect.flatMap(Effect.fromOption));

    return yield* sessions.current(conversation.id);
  });

const currentStatus = (externalId: string) =>
  Effect.map(
    currentSession(externalId),
    Option.map((stored) => stored.session.status),
  );

describe("SessionPool", () => {
  it.effect("closes an idle Session after the timeout and resumes it by cursor", () =>
    Effect.gen(function* () {
      const { channel, harness, sentCount, sessionCount, closedCount } = yield* setup;
      const pool = yield* SessionPool;

      yield* channel.say(message("dm", "m1", "one", dm));
      yield* sentCount(1);
      yield* TestClock.adjust("9 minutes");
      expect(yield* pool.live).toHaveLength(1);

      yield* TestClock.adjust("1 minute");
      yield* closedCount(1);
      yield* eventually(Effect.map(pool.live, (live) => live.length === 0));
      expect(yield* currentStatus("dm")).toEqual(Option.some("idle"));

      yield* channel.say(message("dm", "m2", "two", dm));
      yield* sessionCount(2);

      const [first, second] = yield* Ref.get(harness.sessions);

      expect(second?.request.sessionId).toBe(first?.request.sessionId);
      expect(second?.request.start).toEqual(
        SessionStart.Resume({ cursor: first?.request.sessionId ?? "" }),
      );
    }).pipe(Effect.provide(daemonWith(testConfig)), Effect.scoped),
  );

  it.effect("closes the least recently used idle Session beyond the limit", () =>
    Effect.gen(function* () {
      const { channel, harness, sentCount, closedCount } = yield* setup;
      const pool = yield* SessionPool;

      yield* channel.say(message("dm-a", "a1", "a", dm));
      yield* sentCount(1);
      yield* channel.say(message("dm-b", "b1", "b", dm));
      yield* sentCount(2);
      yield* channel.say(message("dm-a", "a2", "a again", dm));
      yield* sentCount(3);
      yield* channel.say(message("dm-c", "c1", "c", dm));
      yield* sentCount(4);
      yield* closedCount(1);

      const [a, b] = yield* Ref.get(harness.sessions);

      expect(yield* Ref.get(b?.closed ?? Ref.makeUnsafe(false))).toBe(true);
      expect(yield* Ref.get(a?.closed ?? Ref.makeUnsafe(true))).toBe(false);
      expect(yield* pool.live).toHaveLength(2);
      expect(yield* currentStatus("dm-b")).toEqual(Option.some("idle"));
    }).pipe(Effect.provide(daemonWith({ ...testConfig, maxLiveSessions: 2 })), Effect.scoped),
  );

  it.effect("replaces a lost Session with one that gets the Channel history", () =>
    Effect.gen(function* () {
      const { channel, harness, sentCount, sessionCount } = yield* setup;
      const pool = yield* SessionPool;

      yield* Ref.set(harness.manual, true);
      yield* channel.say(message("dm", "m1", "remember this", dm));
      yield* sessionCount(1);

      const [first] = yield* Ref.get(harness.sessions);
      const firstEvents = first?.events ?? (yield* Queue.unbounded());

      yield* Queue.offerAll(firstEvents, [
        HarnessEvent.CursorUpdated({ cursor: "gone" }),
        HarnessEvent.TurnEnded(),
      ]);
      yield* eventually(
        Effect.map(
          currentSession("dm"),
          Option.exists((stored) => Option.contains(stored.cursor, "gone")),
        ),
      );
      yield* pool.closeAll("idle");
      yield* Ref.set(channel.history, [message("dm", "m1", "remember this", dm)]);
      yield* channel.say(message("dm", "m2", "what was it?", dm));
      yield* sessionCount(3);
      yield* sentCount(1);

      const [, resumed, replacement] = yield* Ref.get(harness.sessions);

      const replayed = yield* Ref.get(
        replacement?.inputs ?? Ref.makeUnsafe<ReadonlyArray<string>>([]),
      );

      expect(resumed?.request.start).toEqual(SessionStart.Resume({ cursor: "gone" }));
      expect(replacement?.request.start._tag).toBe("New");
      expect(replayed).toHaveLength(1);
      expect(replayed[0]).toMatch(
        /^<channel-history>\n<message id="m1"[\s\S]*<\/channel-history>\n<context/,
      );
      expect(replayed[0]).toContain('id="m2"');
      expect(yield* Ref.get(channel.sent)).toEqual([
        {
          conversation: "dm",
          text: "⚠️ Previous session was lost; started a new one with recent history.",
        },
      ]);
      expect(yield* currentStatus("dm")).toEqual(Option.some("live"));
    }).pipe(Effect.provide(daemonWith(testConfig)), Effect.scoped),
  );
});
