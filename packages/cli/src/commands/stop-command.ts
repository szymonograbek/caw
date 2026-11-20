import { Console, Effect, Option } from "effect";
import { Command } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";
import { Daemon, pollStatus } from "../daemon.ts";

export const stopCommand = Command.make("stop", {}, () =>
  Effect.gen(function* () {
    const daemon = yield* Daemon;

    yield* daemon.shutdown.pipe(
      Effect.catchTag("DaemonNotRunning", () =>
        Effect.fail(new CliFailure({ message: "Caw is not running." })),
      ),
    );

    // The daemon closes Sessions and Plugins before its socket goes away.
    const gone = yield* pollStatus(daemon, Option.isNone, 100);

    yield* Option.isNone(gone)
      ? Console.log("Caw stopped.")
      : Effect.fail(new CliFailure({ message: "Caw is still stopping; check `caw status`." }));
  }),
).pipe(Command.withDescription("Stop the running daemon"));
