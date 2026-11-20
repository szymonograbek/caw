import { OmenHome } from "@omen/core/omen-home";
import type { DaemonStatus } from "@omen/core/omen-rpcs";
import { describePluginState } from "@omen/core/plugin-state";
import { Console, DateTime, Effect, Option } from "effect";
import { Command } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";
import { Daemon } from "../daemon.ts";

const describe = (status: DaemonStatus, home: string): string => {
  const width = Math.max(...status.plugins.map((plugin) => plugin.name.length));

  return [
    `Omen is running (pid ${status.pid}, since ${DateTime.formatIso(status.startedAt)}).`,
    `Home: ${home}`,
    `Live Sessions: ${status.liveSessions}`,
    "Plugins:",
    ...status.plugins.map(
      (plugin) => `  ${plugin.name.padEnd(width)}  ${describePluginState(plugin.state)}`,
    ),
  ].join("\n");
};

export const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const home = yield* OmenHome;
    const status = yield* Daemon.use((daemon) => daemon.status);

    if (Option.isNone(status)) {
      return yield* new CliFailure({ message: `Omen is not running (home ${home.root}).` });
    }

    return yield* Console.log(describe(status.value, home.root));
  }),
).pipe(Command.withDescription("Show whether the daemon runs, its plugins and live Sessions"));
