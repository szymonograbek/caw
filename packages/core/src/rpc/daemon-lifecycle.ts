import { Context, DateTime, Deferred, Effect, Layer } from "effect";

/** When the daemon started, whether its Plugins are up, and the signal that stops it. */
export class DaemonLifecycle extends Context.Service<
  DaemonLifecycle,
  {
    readonly pid: number;
    readonly startedAt: DateTime.Utc;
    /** Marks every enabled Plugin as started. */
    readonly markReady: Effect.Effect<void>;
    /** Completes once `markReady` ran: Plugins' commands are registered from then on. */
    readonly ready: Effect.Effect<void>;
    readonly shutdown: Effect.Effect<void>;
    /** Completes once `shutdown` ran. */
    readonly stopped: Effect.Effect<void>;
  }
>()("@omen/core/DaemonLifecycle") {
  static readonly layer = Layer.effect(
    DaemonLifecycle,
    Effect.gen(function* () {
      const signal = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();

      return {
        pid: process.pid,
        startedAt: yield* DateTime.now,
        markReady: Deferred.succeed(started, undefined),
        ready: Deferred.await(started),
        shutdown: Deferred.succeed(signal, undefined),
        stopped: Deferred.await(signal),
      };
    }),
  );
}
