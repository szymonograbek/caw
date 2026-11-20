import { Config, Context, Duration, Effect, Layer } from "effect";

/** Daemon tuning, read from `CAW_*` config with the spec's defaults. */
export class DaemonConfig extends Context.Service<
  DaemonConfig,
  {
    readonly idleTimeout: Duration.Duration;
    readonly maxLiveSessions: number;
    /** IANA zone used to show message times to the agent. */
    readonly timezone: string;
    /** How many Channel messages a lost Session's replacement gets as `<channel-history>`. */
    readonly historyLimit: number;
  }
>()("@caw/core/DaemonConfig") {
  static readonly layer = Layer.effect(
    DaemonConfig,
    Effect.gen(function* () {
      const idleTimeout = yield* Config.Duration("CAW_IDLE_TIMEOUT").pipe(
        Config.withDefault(Duration.minutes(10)),
      );

      const maxLiveSessions = yield* Config.Int("CAW_MAX_LIVE_SESSIONS").pipe(
        Config.withDefault(5),
      );

      const timezone = yield* Config.String("CAW_TIMEZONE").pipe(
        Config.withDefault(Intl.DateTimeFormat().resolvedOptions().timeZone),
      );

      const historyLimit = yield* Config.Int("CAW_HISTORY_LIMIT").pipe(Config.withDefault(50));

      return { idleTimeout, maxLiveSessions, timezone, historyLimit };
    }),
  );
}
