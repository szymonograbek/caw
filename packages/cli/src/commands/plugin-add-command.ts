import { OfflineHost } from "@omen/core/offline-host";
import { Console, Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";
import { Daemon } from "../daemon.ts";
import { Invocation } from "../invocation.ts";

/**
 * `omen plugin add`: a running daemon installs and starts the Plugin itself;
 * without one the CLI installs it, and the daemon starts it on its next start.
 */
const add = Command.make("add", { source: Argument.String("source") }, ({ source }) =>
  Effect.gen(function* () {
    const daemon = yield* Daemon;
    const offline = yield* OfflineHost;
    const { cwd, conversationId } = yield* Invocation;

    const output = yield* daemon
      .run({ argv: ["plugin", "add", source], conversationId, cwd })
      .pipe(
        Effect.catchTag("DaemonNotRunning", () =>
          offline
            .add(source, cwd)
            .pipe(
              Effect.map(
                (name) => `Installed plugin ${name}. It starts with the daemon: omen start`,
              ),
            ),
        ),
      );

    yield* Console.log(output);
  }).pipe(
    Effect.catchTags({
      CliCommandError: ({ message }) => Effect.fail(new CliFailure({ message })),
      PluginInstallError: ({ message }) => Effect.fail(new CliFailure({ message })),
    }),
  ),
).pipe(Command.withDescription("Install a plugin from a git URL, an npm name or a path"));

/** Only `add` runs in the CLI; every other `omen plugin` command runs in the daemon. */
export const pluginAddCommand = Command.make("plugin").pipe(
  Command.withDescription("Manage plugins (only `add` works without the daemon)"),
  Command.withSubcommands([add]),
);
