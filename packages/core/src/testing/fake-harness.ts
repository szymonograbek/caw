import type { Harness, HarnessEvent, OpenSession } from "@gloaming/caw-plugin-sdk/harness";
import {
  HarnessEvent as Events,
  SessionNotFound,
  SessionStart,
} from "@gloaming/caw-plugin-sdk/harness";
import { HarnessName } from "@gloaming/caw-plugin-sdk/ids";
import type { Cause } from "effect";
import { Effect, Queue, Ref, Stream } from "effect";

/** One Session the fake Harness opened. */
export interface FakeSession {
  readonly request: OpenSession;
  readonly inputs: Ref.Ref<ReadonlyArray<string>>;
  readonly events: Queue.Queue<HarnessEvent, Cause.Done>;
  readonly interrupts: Ref.Ref<number>;
  readonly closed: Ref.Ref<boolean>;
}

/**
 * A Harness driven by the test. In `auto` mode each input gets a reply and a
 * finished Turn; in `manual` mode the test emits events itself. Resuming the
 * cursor `"gone"` reports `SessionNotFound` on the first input, like Claude.
 */
export const makeFakeHarness = Effect.gen(function* () {
  const sessions = yield* Ref.make<ReadonlyArray<FakeSession>>([]);
  const manual = yield* Ref.make(false);

  const harness: Harness = {
    name: HarnessName.make("fake"),
    open: (request) =>
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<HarnessEvent, Cause.Done>();

        const session: FakeSession = {
          request,
          inputs: yield* Ref.make<ReadonlyArray<string>>([]),
          events,
          interrupts: yield* Ref.make(0),
          closed: yield* Ref.make(false),
        };

        const lost = SessionStart.$is("Resume")(request.start) && request.start.cursor === "gone";

        yield* Effect.addFinalizer(() => Ref.set(session.closed, true));
        yield* Ref.update(sessions, (all) => [...all, session]);

        return {
          send: (input) =>
            Effect.gen(function* () {
              const count = (yield* Ref.updateAndGet(session.inputs, (all) => [...all, input]))
                .length;

              if (lost) {
                yield* Queue.offer(
                  events,
                  Events.Failed({ error: new SessionNotFound({ harness: "fake" }) }),
                );
                yield* Queue.end(events);

                return;
              }

              if (!(yield* Ref.get(manual))) {
                yield* Queue.offerAll(events, [
                  Events.Text({ text: `reply ${count}` }),
                  Events.CursorUpdated({ cursor: request.sessionId }),
                  Events.TurnEnded(),
                ]);
              }
            }),
          interrupt: Ref.update(session.interrupts, (n) => n + 1),
          events: Stream.fromQueue(events),
        };
      }),
  };

  return { harness, sessions, manual };
});

export type FakeHarness = Effect.Success<typeof makeFakeHarness>;
