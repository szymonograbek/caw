import { Console, Effect } from "effect";
import { CliFailure } from "./cli-failure.ts";
import { Daemon } from "./daemon.ts";
import { Invocation } from "./invocation.ts";

/** Runs `omen <argv>` inside the daemon and prints what it returns. */
export const forward = (argv: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const daemon = yield* Daemon;
    const { cwd, conversationId } = yield* Invocation;
    const output = yield* daemon.run({ argv, conversationId, cwd });

    if (output.length > 0) {
      yield* Console.log(output);
    }
  }).pipe(
    Effect.catchTags({
      CliCommandError: ({ message }) => Effect.fail(new CliFailure({ message })),
      DaemonNotRunning: () =>
        Effect.fail(
          new CliFailure({ message: "Omen is not running. Start it with `omen start`." }),
        ),
    }),
  );
