import { runDaemon } from "@caw/core/daemon";
import { CawHome } from "@caw/core/caw-home";
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
    const home = yield* CawHome;
    const running = yield* daemon.status;

    if (Option.isSome(running)) {
      return yield* new CliFailure({
        message: `Caw is already running (pid ${running.value.pid}).`,
      });
    }

    yield* Console.log(`Starting Caw in ${home.root}. Logs: ${home.logFile}`);

    return yield* runDaemon({ builtins, cli: invocation.cli });
  }),
).pipe(Command.withDescription("Run the daemon in the foreground until stopped"));
