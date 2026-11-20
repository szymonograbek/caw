import type { SessionStatus } from "@omen/sdk/conversation";
import type { SessionCloseReason } from "@omen/sdk/events";
import { OmenEvent } from "@omen/sdk/events";
import type { SessionId } from "@omen/sdk/ids";
import { Machine } from "@typeonce/effect-machine";
import {
  Array,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Ref,
  Scope,
  Semaphore,
} from "effect";
import { DaemonConfig } from "../home/daemon-config.ts";
import { EventBus } from "../events/event-bus.ts";
import { Sessions } from "../store/sessions.ts";
import type { SessionInput } from "./session-link.ts";
import { SessionLink } from "./session-link.ts";
import { SessionLinks } from "./session-link-live.ts";
import { SessionRecovery } from "./session-recovery.ts";
import {
  SessionEnding,
  SessionEvents,
  SessionMachine,
  SessionStates,
  endingOf,
} from "./session-machine.ts";
import type { SessionTarget } from "./session-target.ts";

const startMachine = (idleTimeout: Duration.Duration) =>
  Machine.start(SessionMachine, { idleTimeoutMillis: Duration.toMillis(idleTimeout) });

interface Runner {
  readonly target: SessionTarget;
  readonly inputs: Queue.Queue<SessionInput>;
  readonly machine: Effect.Success<ReturnType<typeof startMachine>>;
  /** Completes once the Session's row and the pool reflect that it ended. */
  readonly ended: Deferred.Deferred<void>;
}

const statusAfterClose = (reason: SessionCloseReason): SessionStatus =>
  reason === "reset" || reason === "profile-changed" ? "closed" : "idle";

/**
 * The live Sessions, at most `maxLiveSessions` of them. Opening one more
 * closes the least recently used idle one.
 */
export class SessionPool extends Context.Service<
  SessionPool,
  {
    /** Delivers an input, opening the Session first when it is not live. */
    readonly submit: (target: SessionTarget, input: SessionInput) => Effect.Effect<void>;
    /** Interrupts the running Turn, if any. */
    readonly interrupt: (session: SessionId) => Effect.Effect<void>;
    /** Closes a Session, live or not, and records why. */
    readonly close: (session: SessionId, reason: SessionCloseReason) => Effect.Effect<void>;
    readonly closeAll: (reason: SessionCloseReason) => Effect.Effect<void>;
    readonly live: Effect.Effect<ReadonlyArray<SessionId>>;
  }
>()("@omen/core/SessionPool") {
  static readonly layer = Layer.effect(
    SessionPool,
    Effect.gen(function* () {
      const config = yield* DaemonConfig;
      const sessions = yield* Sessions;
      const bus = yield* EventBus;
      const links = yield* SessionLinks;
      const recovery = yield* SessionRecovery;
      const layerScope = yield* Effect.scope;
      // Runners live in a child scope so the shutdown finalizer below still sees them.
      const poolScope = yield* Scope.fork(layerScope);
      /** Least recently used first. */
      const runners = yield* Ref.make<ReadonlyArray<Runner>>([]);
      const lock = yield* Semaphore.make(1);

      const find = (session: SessionId) =>
        Effect.map(
          Ref.get(runners),
          Array.findFirst((runner) => runner.target.session.id === session),
        );

      const remove = (runner: Runner) =>
        Ref.update(runners, (all) => all.filter((entry) => entry !== runner));

      const closeRunner = (runner: Runner, reason: SessionCloseReason) =>
        runner.machine
          .send(SessionEvents.Close({ reason }))
          .pipe(Effect.ignore, Effect.andThen(Deferred.await(runner.ended)));

      const evictIfFull = Effect.gen(function* () {
        const all = yield* Ref.get(runners);

        if (all.length < config.maxLiveSessions) {
          return;
        }

        const states = yield* Effect.forEach(all, (runner) =>
          Effect.map(runner.machine.state, (state) => ({ runner, state })),
        );

        const idle = states.find(({ state }) => SessionStates.matches(state, "Open.Live.Idle"));

        if (idle !== undefined) {
          yield* closeRunner(idle.runner, "evicted");
        }
      });

      const settle = (runner: Runner, ending: SessionEnding, scope: Scope.Closeable) =>
        Effect.gen(function* () {
          const { session } = runner.target;
          const leftover = yield* Queue.clear(runner.inputs);

          yield* remove(runner);
          yield* Scope.close(scope, Exit.void);
          yield* SessionEnding.$match(ending, {
            Closed: ({ reason }) =>
              Effect.gen(function* () {
                yield* sessions.setStatus(session.id, statusAfterClose(reason));
                yield* bus.publish(OmenEvent.SessionClosed({ sessionId: session.id, reason }));
                yield* Deferred.succeed(runner.ended, undefined);
              }),
            Lost: ({ replay }) =>
              Effect.gen(function* () {
                yield* sessions.setStatus(session.id, "lost");
                yield* Deferred.succeed(runner.ended, undefined);

                const unanswered = [...replay, ...leftover];

                if (unanswered.length > 0) {
                  const replacement = yield* recovery.replace(runner.target, unanswered);

                  yield* submit(replacement.target, replacement.input);
                }
              }),
            Broken: ({ message, replay }) =>
              Effect.gen(function* () {
                yield* Effect.logError("Session broke", message).pipe(
                  Effect.annotateLogs({ sessionId: session.id }),
                );
                yield* sessions.setStatus(session.id, "idle");
                yield* Deferred.succeed(runner.ended, undefined);

                const unanswered = [...replay, ...leftover];

                if (unanswered.length > 0) {
                  yield* recovery.reportUnanswered(runner.target, unanswered, message);
                }
              }),
          });
        });

      const open = (target: SessionTarget) =>
        Effect.gen(function* () {
          yield* evictIfFull;

          const scope = yield* Scope.fork(poolScope);
          const inputs = yield* Queue.unbounded<SessionInput>();
          const link = yield* links.make(target, inputs);

          const machine = yield* startMachine(config.idleTimeout).pipe(
            Effect.provideService(SessionLink, link),
            Scope.provide(scope),
            Effect.orDie,
          );

          const runner: Runner = { target, inputs, machine, ended: yield* Deferred.make<void>() };

          yield* Ref.update(runners, (all) => [...all, runner]);
          yield* sessions.setStatus(target.session.id, "live");
          yield* Machine.waitFor(machine, (snapshot) => snapshot.status !== "active").pipe(
            Effect.map((snapshot) => endingOf(snapshot.state)),
            Effect.orElseSucceed(() =>
              SessionEnding.Broken({ message: "The Session stopped.", replay: [] }),
            ),
            Effect.flatMap((ending) => settle(runner, ending, scope)),
            Effect.forkIn(poolScope),
          );

          return runner;
        });

      const submit = (target: SessionTarget, input: SessionInput): Effect.Effect<void> =>
        lock.withPermit(
          Effect.gen(function* () {
            const existing = yield* find(target.session.id);
            const runner = Option.isSome(existing) ? existing.value : yield* open(target);

            yield* Ref.update(runners, (all) => [
              ...all.filter((entry) => entry !== runner),
              runner,
            ]);
            yield* Queue.offer(runner.inputs, input);
          }),
        );

      const closeAll = (reason: SessionCloseReason) =>
        lock.withPermit(
          Effect.flatMap(
            Ref.get(runners),
            Effect.forEach((runner) => closeRunner(runner, reason)),
          ),
        );

      yield* Effect.addFinalizer(() => closeAll("shutdown"));

      return {
        submit,
        interrupt: (session) =>
          Effect.flatMap(find(session), (runner) =>
            Option.match(runner, {
              onNone: () => Effect.void,
              onSome: ({ machine }) => Effect.ignore(machine.send(SessionEvents.Interrupt())),
            }),
          ),
        close: (session, reason) =>
          lock.withPermit(
            Effect.flatMap(find(session), (runner) =>
              Option.match(runner, {
                onSome: (live) => closeRunner(live, reason),
                onNone: () =>
                  sessions
                    .setStatus(session, statusAfterClose(reason))
                    .pipe(
                      Effect.andThen(
                        bus.publish(OmenEvent.SessionClosed({ sessionId: session, reason })),
                      ),
                    ),
              }),
            ),
          ),
        closeAll,
        live: Effect.map(
          Ref.get(runners),
          Array.map((runner) => runner.target.session.id),
        ),
      };
    }),
  );
}
