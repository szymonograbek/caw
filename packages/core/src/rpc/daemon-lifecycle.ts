import { Context, DateTime, Deferred, Effect, Layer } from "effect";

/** When the daemon started, and the signal that stops it. */
export class DaemonLifecycle extends Context.Service<
  DaemonLifecycle,
  {
    readonly pid: number;
    readonly startedAt: DateTime.Utc;
    readonly shutdown: Effect.Effect<void>;
    /** Completes once `shutdown` ran. */
    readonly stopped: Effect.Effect<void>;
  }
>()("@omen/core/DaemonLifecycle") {
  static readonly layer = Layer.effect(
    DaemonLifecycle,
    Effect.gen(function* () {
      const signal = yield* Deferred.make<void>();

      return {
        pid: process.pid,
        startedAt: yield* DateTime.now,
        shutdown: Deferred.succeed(signal, undefined),
        stopped: Deferred.await(signal),
      };
    }),
  );
}
