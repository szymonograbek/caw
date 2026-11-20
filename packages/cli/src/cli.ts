import { OfflineHost } from "@omen/core/offline-host";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { builtins } from "./builtins.ts";
import { guideCommand } from "./commands/guide-command.ts";
import { logsCommand } from "./commands/logs-command.ts";
import { pluginAddCommand } from "./commands/plugin-add-command.ts";
import { startCommand } from "./commands/start-command.ts";
import { statusCommand } from "./commands/status-command.ts";
import { stopCommand } from "./commands/stop-command.ts";
import { installCommand } from "./install/install-command.ts";

/** The commands that work without a daemon, over the built-in and installed Plugins. */
export const runLocal = (argv: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const installed = yield* OfflineHost.use((host) => host.installed);

    const omen = Command.make("omen").pipe(
      Command.withDescription(
        "Control Omen. Commands not listed here (plugin, conversation, profile, schedule, memory) run in the daemon; see `omen guide`.",
      ),
      Command.withSubcommands([
        installCommand(builtins, installed),
        startCommand,
        stopCommand,
        statusCommand,
        logsCommand,
        guideCommand([...builtins, ...installed]),
        pluginAddCommand,
      ]),
    );

    yield* Command.runWith(omen, { version: "0.0.0" })(argv);
  });
