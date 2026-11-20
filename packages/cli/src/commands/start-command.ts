import { runDaemon } from "@omen/core/daemon";
import { OmenHome } from "@omen/core/omen-home";
import { Console, Effect, Option } from "effect";
import { Command } from "effect/cli";
import { builtins } from "../builtins.ts";
import { CliFailure } from "../cli-failure.ts";
import { Daemon } from "../daemon.ts";
import { Invocation } from "../invocation.ts";

export const startCommand = Command.make("start", {}, () =>
  Effect.gen(function* () {
    const daemon = yield* Daemon;
    const invocation = yield* Invocation;
    const home = yield* OmenHome;
    const running = yield* daemon.status;

    if (Option.isSome(running)) {
      return yield* new CliFailure({
        message: `Omen is already running (pid ${running.value.pid}).`,
      });
    }

    yield* Console.log(`Starting Omen in ${home.root}. Logs: ${home.logFile}`);

    return yield* runDaemon({ builtins, cli: invocation.cli });
  }),
).pipe(Command.withDescription("Run the daemon in the foreground until stopped"));
