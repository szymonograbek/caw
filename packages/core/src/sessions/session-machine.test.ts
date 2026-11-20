import { describe, expect, it } from "@effect/vitest";
import { ChannelMessageId, ExternalConversationId } from "@omen/sdk/ids";
import { Machine } from "@typeonce/effect-machine";
import { Effect, Layer, Option, Queue, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  DeliverySignal,
  HarnessSignal,
  MessageRef,
  SessionInput,
  SessionLink,
} from "./session-link.ts";
import { SessionEvents, SessionMachine, SessionStates } from "./session-machine.ts";

const input = (id: string) =>
  new SessionInput({
    text: `<message id="${id}"/>`,
    messages: [
      new MessageRef({
        conversation: ExternalConversationId.make("room"),
        id: ChannelMessageId.make(id),
      }),
    ],
  });

const setup = Effect.gen(function* () {
  const harness = yield* Queue.unbounded<HarnessSignal>();
  const deliveries = yield* Queue.unbounded<DeliverySignal>();
  const log = yield* Ref.make<ReadonlyArray<string>>([]);
  const record = (entry: string) => Ref.update(log, (entries) => [...entries, entry]);

  const link = Layer.succeed(SessionLink, {
    harness: Stream.fromQueue(harness),
    deliveries: Stream.fromQueue(deliveries),
    turn: Effect.acquireRelease(record("typing on"), () => record("typing off")).pipe(
      Effect.andThen(Effect.never),
      Effect.scoped,
    ),
    stopTurn: (inFlight) =>
      record(`stopped ${inFlight.flatMap((i) => i.messages.map((m) => m.id)).join(",")}`),
    reportFailure: (failure) =>
      record(
        `failed ${failure.inFlight.flatMap((i) => i.messages.map((m) => m.id)).join(",")}: ${failure.message}`,
      ),
  });

  const ref = yield* Machine.start(SessionMachine, { idleTimeoutMillis: 60_000 }).pipe(
    Effect.provide(link),
  );

  const settle = Effect.yieldNow.pipe(Effect.repeat({ times: 20 }));

  const at = (path: Parameters<typeof SessionStates.matches>[1]) =>
    Effect.map(ref.state, (state) => SessionStates.matches(state, path));

  return { ref, harness, deliveries, log, settle, at };
});

describe("SessionMachine", () => {
  it.effect("opens, runs a Turn, Steers it, and returns to Idle", () =>
    Effect.gen(function* () {
      const { harness, deliveries, log, settle, at } = yield* setup;

      expect(yield* at("Open.Opening")).toBe(true);
      yield* Queue.offer(harness, HarnessSignal.cases.Opened.make({}));
      yield* settle;
      expect(yield* at("Open.Live.Idle")).toBe(true);

      yield* Queue.offer(
        deliveries,
        DeliverySignal.cases.InputDelivered.make({ input: input("m1") }),
      );
      yield* Queue.offer(
        deliveries,
        DeliverySignal.cases.InputDelivered.make({ input: input("m2") }),
      );
      yield* settle;
      expect(yield* at("Open.Live.Running")).toBe(true);

      yield* Queue.offer(harness, HarnessSignal.cases.TurnCompleted.make({}));
      yield* settle;
      expect(yield* at("Open.Live.Idle")).toBe(true);
      expect(yield* Ref.get(log)).toEqual(["typing on", "typing off"]);
    }).pipe(Effect.scoped),
  );

  it.effect("stops a running Turn and reports its triggering messages", () =>
    Effect.gen(function* () {
      const { ref, harness, deliveries, log, settle, at } = yield* setup;

      yield* Queue.offer(harness, HarnessSignal.cases.Opened.make({}));
      yield* Queue.offer(
        deliveries,
        DeliverySignal.cases.InputDelivered.make({ input: input("m1") }),
      );
      yield* Queue.offer(
        deliveries,
        DeliverySignal.cases.InputDelivered.make({ input: input("m2") }),
      );
      yield* settle;
      yield* ref.send(SessionEvents.Interrupt());
      yield* settle;

      expect(yield* at("Open.Live.Idle")).toBe(true);
      expect(yield* Ref.get(log)).toContain("stopped m1,m2");
    }).pipe(Effect.scoped),
  );

  it.effect("closes after the idle timeout", () =>
    Effect.gen(function* () {
      const { ref, harness, settle, at } = yield* setup;

      yield* Queue.offer(harness, HarnessSignal.cases.Opened.make({}));
      yield* settle;
      yield* TestClock.adjust("59 seconds");
      expect(yield* at("Open.Live.Idle")).toBe(true);
      yield* TestClock.adjust("1 second");
      yield* settle;

      const state = yield* ref.state;
      expect(SessionStates.get(state, "Closed").pipe(Option.map((s) => s.reason))).toEqual(
        Option.some("idle"),
      );
    }).pipe(Effect.scoped),
  );
});
