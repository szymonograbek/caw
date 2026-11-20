import type { PluginName } from "@gloaming/caw-plugin-sdk/ids";
import { CliCommandError } from "@gloaming/caw-plugin-sdk/plugin";
import { Context, Effect, Layer, Option } from "effect";
import { resolvePluginSource } from "../commands/plugin-command.ts";
import { updateDotEnv } from "../home/env-file.ts";
import type { HostFileError } from "../home/host-files.ts";
import { HostFiles } from "../home/host-files.ts";
import { CawHome } from "../home/caw-home.ts";
import { hostCoreLayer } from "../host-core-layer.ts";
import { PluginRows } from "../store/plugin-rows.ts";
import type { LoadedPlugin } from "./loaded-plugin.ts";
import type { PluginInstallError } from "./plugin-installer.ts";
import { PluginInstaller } from "./plugin-installer.ts";
import { PluginScopes } from "./plugin-scopes.ts";
import { Registry } from "./registry.ts";

/**
 * What the CLI does to `<home>` without a running daemon: read installed
 * Plugins, install one, choose which are enabled, and run one Plugin's command.
 */
export class OfflineHost extends Context.Service<
  OfflineHost,
  {
    /** Installed external Plugins; one that fails to load is left out. */
    readonly installed: Effect.Effect<ReadonlyArray<LoadedPlugin>>;
    /** Sets entries in `<home>/.env`, keeping its other lines; the file stays private (0600). */
    readonly saveEnv: (
      entries: Readonly<Record<string, string>>,
    ) => Effect.Effect<void, HostFileError>;
    /** `caw plugin add` without a daemon; the daemon starts it on its next start. */
    readonly add: (source: string, cwd: string) => Effect.Effect<PluginName, PluginInstallError>;
    /**
     * Records the built-ins as the daemon's first start would, then sets each
     * listed Plugin's enabled flag. Unlisted Plugins keep theirs.
     */
    readonly setEnabled: (
      builtins: ReadonlyArray<LoadedPlugin>,
      choices: ReadonlyArray<readonly [PluginName, boolean]>,
    ) => Effect.Effect<void>;
    /**
     * Starts only `plugin`, with its stored settings, and runs `caw <argv>`
     * against the commands it registers. For Plugins whose command just
     * writes their own store, such as `profile add`.
     */
    readonly runCommand: (
      plugin: LoadedPlugin,
      argv: ReadonlyArray<string>,
    ) => Effect.Effect<string, CliCommandError>;
  }
>()("@caw/core/OfflineHost") {
  static readonly layer = Layer.effect(
    OfflineHost,
    Effect.gen(function* () {
      const rows = yield* PluginRows;
      const installer = yield* PluginInstaller;
      const registry = yield* Registry;
      const scopes = yield* PluginScopes;
      const home = yield* CawHome;
      const files = yield* HostFiles;

      const saveEnv = Effect.fn("OfflineHost.saveEnv")(function* (
        entries: Readonly<Record<string, string>>,
      ) {
        const contents = Option.getOrElse(yield* files.readText(home.envFile), () => "");

        yield* files.ensureDirectory(home.root);
        yield* files.writeText(home.envFile, updateDotEnv(contents, entries));
        yield* files.setMode(home.envFile, 0o600);
      });

      const installed = Effect.flatMap(rows.list, (all) =>
        Effect.forEach(
          all.filter((row) => row.source !== "builtin"),
          (row) =>
            installer.load(row.name).pipe(
              Effect.asSome,
              Effect.catchTag("PluginInstallError", (error) =>
                Effect.as(
                  Effect.logWarning("An installed Plugin did not load", error),
                  Option.none(),
                ),
              ),
            ),
        ),
      ).pipe(Effect.map((loaded) => loaded.flatMap(Option.toArray)));

      const add = Effect.fn("OfflineHost.add")(function* (source: string, cwd: string) {
        const resolved = resolvePluginSource(source, cwd);
        const plugin = yield* installer.install(resolved);

        yield* rows.add(plugin.name, resolved, plugin.version);

        return plugin.name;
      });

      const setEnabled = Effect.fn("OfflineHost.setEnabled")(function* (
        builtins: ReadonlyArray<LoadedPlugin>,
        choices: ReadonlyArray<readonly [PluginName, boolean]>,
      ) {
        yield* Effect.forEach(builtins, (plugin) => rows.add(plugin.name, "builtin", "builtin"));
        yield* Effect.forEach(choices, ([name, enabled]) => rows.setEnabled(name, enabled));
      });

      const runCommand = (plugin: LoadedPlugin, argv: ReadonlyArray<string>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const row = yield* rows.get(plugin.name);

            const settings = Option.match(row, {
              onNone: () => ({}),
              onSome: (found) => found.settings,
            });

            const layer = yield* plugin
              .layerFor(settings)
              .pipe(Effect.mapError(({ message }) => new CliCommandError({ message })));

            const scope = yield* Effect.scope;

            yield* scopes.launch(plugin, layer, scope);

            const [name, ...args] = argv;
            const command = name === undefined ? Option.none() : yield* registry.cliCommand(name);

            if (Option.isNone(command)) {
              return yield* new CliCommandError({
                message: `${plugin.name} has no command ${name ?? ""}`,
              });
            }

            return yield* command.value.run(args, { conversationId: Option.none(), cwd: "/" });
          }),
        );

      return { installed, saveEnv, add, setEnabled, runCommand };
    }),
  );

  /** On this host's `CAW_HOME`, with everything it needs. */
  static readonly standalone = OfflineHost.layer.pipe(Layer.provide(hostCoreLayer));
}
