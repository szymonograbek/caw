import { OfflineHost } from "@caw/core/offline-host";
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

    const caw = Command.make("caw").pipe(
      Command.withDescription(
        "Control Caw. Commands not listed here (plugin, conversation, profile, schedule, memory) run in the daemon; see `caw guide`.",
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

    yield* Command.runWith(caw, { version: "1.0.0" })(argv);
  });
