import { CawHome } from "@caw/core/caw-home";
import type { DaemonStatus } from "@caw/core/caw-rpcs";
import { describePluginState } from "@caw/core/plugin-state";
import { Console, DateTime, Effect, Option } from "effect";
import { Command } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";
import { Daemon } from "../daemon.ts";

const describe = (status: DaemonStatus, home: string): string => {
  const width = Math.max(...status.plugins.map((plugin) => plugin.name.length));

  return [
    `Caw is running (pid ${status.pid}, since ${DateTime.formatIso(status.startedAt)}).`,
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
    const home = yield* CawHome;
    const status = yield* Daemon.use((daemon) => daemon.status);

    if (Option.isNone(status)) {
      return yield* new CliFailure({ message: `Caw is not running (home ${home.root}).` });
    }

    return yield* Console.log(describe(status.value, home.root));
  }),
).pipe(Command.withDescription("Show whether the daemon runs, its plugins and live Sessions"));
