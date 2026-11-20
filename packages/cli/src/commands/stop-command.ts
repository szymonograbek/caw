import { Console, Effect, Option, Schedule } from "effect";
import { Command } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";
import { Daemon } from "../daemon.ts";

export const stopCommand = Command.make("stop", {}, () =>
  Effect.gen(function* () {
    const daemon = yield* Daemon;

    yield* daemon.shutdown.pipe(
      Effect.catchTag("DaemonNotRunning", () =>
        Effect.fail(new CliFailure({ message: "Omen is not running." })),
      ),
    );

    // The daemon closes Sessions and Plugins before its socket goes away.
    const gone = yield* daemon.status.pipe(
      Effect.repeat({
        schedule: Schedule.spaced("100 millis"),
        until: Option.isNone,
        times: 100,
      }),
    );

    yield* Option.isNone(gone)
      ? Console.log("Omen stopped.")
      : Effect.fail(new CliFailure({ message: "Omen is still stopping; check `omen status`." }));
  }),
).pipe(Command.withDescription("Stop the running daemon"));
