import * as Fs from "node:fs/promises";
import * as NodePath from "node:path";
import { PluginName } from "@gloaming/sdk/ids";
import type { Migration, PluginServices } from "@gloaming/sdk/plugin";
import { PluginSetup } from "@gloaming/sdk/setup";
import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";
import { HostFiles } from "../home/host-files.ts";
import { CawHome } from "../home/caw-home.ts";
import { newSessionId } from "../store/new-ids.ts";
import type { LoadedPlugin } from "./loaded-plugin.ts";
import { InvalidPluginSettings } from "./loaded-plugin.ts";

export class PluginInstallError extends Schema.TaggedError<
  PluginInstallError,
  { readonly brand: unique symbol }
>()("PluginInstallError", {
  source: Schema.String,
  message: Schema.String,
}) {}

/** An external Plugin installed under `<home>/plugins/<name>/`. */
export interface InstalledPlugin {
  readonly name: PluginName;
  readonly version: string;
}

// A dynamically imported module carries no types; these guards are the boundary
// where its shape is checked. The function and Effect types cannot be checked at
// runtime: a Plugin that lies about them fails when core runs it.
const isCodec = (u: unknown): u is Schema.Codec<unknown, unknown> => Schema.isSchema(u);

// SAFETY: the imported factory is untyped; its result is checked with `isPluginLayer` before use.
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns
const isLayerFactory = (u: unknown): u is (settings: unknown) => unknown => Predicate.isFunction(u);
const isMigrationRun = (u: unknown): u is Migration["run"] => Effect.isEffect(u);

const isPluginSetup = (u: unknown): u is PluginSetup =>
  PluginSetup.$is("Channel")(u) || PluginSetup.$is("Harness")(u);

const isPluginLayer = (u: unknown): u is Layer.Layer<never, never, PluginServices> =>
  Layer.isLayer(u);

const PluginModule = Schema.Struct({
  default: Schema.Struct({
    name: PluginName,
    settings: Schema.declare(isCodec),
    migrations: Schema.Array(
      Schema.Struct({ id: Schema.Int, name: Schema.String, run: Schema.declare(isMigrationRun) }),
    ),
    guide: Schema.Array(
      Schema.Struct({ topic: Schema.String, summary: Schema.String, body: Schema.String }),
    ),
    skillDir: Schema.Option(Schema.String),
    setup: Schema.optional(Schema.declare(isPluginSetup)),
    layer: Schema.declare(isLayerFactory),
  }),
});

const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.optional(Schema.String),
    dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    caw: Schema.optional(Schema.Struct({ name: PluginName, version: Schema.String })),
  }),
);

const failWith = (source: string) => (cause: unknown) =>
  new PluginInstallError({ source, message: String(cause) });

/**
 * Runs `bun add <source>` in `folder` with the Bun running Caw. `BUN_BE_BUN`
 * makes a compiled `caw` binary act as the Bun it embeds.
 */
const bunAdd = (folder: string, source: string) =>
  Effect.gen(function* () {
    const child = yield* Effect.sync(() =>
      Bun.spawn([process.execPath, "add", source], {
        cwd: folder,
        env: { ...process.env, BUN_BE_BUN: "1" },
        stdout: "ignore",
        stderr: "pipe",
      }),
    );

    const [code, stderr] = yield* Effect.tryPromise({
      try: () => Promise.all([child.exited, child.stderr.text()]),
      catch: failWith(source),
    });

    return { code, stderr };
  }).pipe(
    Effect.filterOrFail(
      ({ code }) => code === 0,
      ({ stderr }) => new PluginInstallError({ source, message: stderr.trim() }),
    ),
  );

/**
 * Installs external Plugins with `bun add` into their own folder and loads
 * them with a dynamic `import()` of the package's default export.
 */
export class PluginInstaller extends Context.Service<
  PluginInstaller,
  {
    /** `source` is anything `bun add` accepts: a git URL, an npm name or a path. */
    readonly install: (source: string) => Effect.Effect<InstalledPlugin, PluginInstallError>;
    readonly load: (name: PluginName) => Effect.Effect<LoadedPlugin, PluginInstallError>;
    /** Deletes the Plugin's folder. */
    readonly uninstall: (name: PluginName) => Effect.Effect<void, PluginInstallError>;
  }
>()("@gloaming/core/PluginInstaller") {
  static readonly layer = Layer.effect(
    PluginInstaller,
    Effect.gen(function* () {
      const home = yield* CawHome;
      const files = yield* HostFiles;

      const readPackage = (path: string, source: string) =>
        files
          .readText(NodePath.join(path, "package.json"))
          .pipe(
            Effect.flatMap(Effect.fromOption),
            Effect.flatMap(Schema.decodeEffect(PackageJson)),
            Effect.mapError(failWith(source)),
          );

      /** The one package `bun add` put into a Plugin folder. */
      const installedPackage = Effect.fn("PluginInstaller.installedPackage")(function* (
        folder: string,
        source: string,
      ) {
        const manifest = yield* readPackage(folder, source);
        const [dependency] = Object.keys(manifest.dependencies ?? {});

        if (dependency === undefined) {
          return yield* new PluginInstallError({ source, message: "Nothing was installed." });
        }

        return NodePath.join(folder, "node_modules", dependency);
      });

      const install = Effect.fn("PluginInstaller.install")(function* (source: string) {
        const staging = NodePath.join(home.pluginsDir, `.staging-${yield* newSessionId}`);

        yield* files.ensureDirectory(staging).pipe(Effect.mapError(failWith(source)));
        yield* files
          .writeText(NodePath.join(staging, "package.json"), '{ "private": true }\n')
          .pipe(Effect.mapError(failWith(source)));

        const installed = yield* Effect.gen(function* () {
          yield* bunAdd(staging, source);

          const installedAt = yield* installedPackage(staging, source);
          const manifest = yield* readPackage(installedAt, source);

          if (manifest.caw === undefined) {
            return yield* new PluginInstallError({
              source,
              message: 'The package has no "caw" key in its package.json.',
            });
          }

          const target = NodePath.join(home.pluginsDir, manifest.caw.name);

          yield* files.remove(target).pipe(Effect.mapError(failWith(source)));
          yield* Effect.tryPromise({
            try: () => Fs.rename(staging, target),
            catch: failWith(source),
          });

          return { name: manifest.caw.name, version: manifest.caw.version };
        }).pipe(Effect.ensuring(Effect.ignore(files.remove(staging))));

        return installed;
      });

      const load = Effect.fn("PluginInstaller.load")(function* (name: PluginName) {
        const entry = yield* installedPackage(NodePath.join(home.pluginsDir, name), name);

        const imported = yield* Effect.tryPromise({
          // SAFETY: a dynamic import is untyped; `PluginModule` decodes it right below.
          // oxlint-disable-next-line anti-slop/no-unknown-returns
          try: (): Promise<unknown> => import(entry),
          catch: failWith(name),
        });

        const definition = (yield* Schema.decodeUnknownEffect(PluginModule)(imported).pipe(
          Effect.mapError(failWith(name)),
        )).default;

        const decodeSettings = Schema.decodeUnknownEffect(definition.settings);

        const plugin: LoadedPlugin = {
          name: definition.name,
          migrations: definition.migrations,
          guide: definition.guide,
          skillDir: definition.skillDir,
          setup: Option.fromNullishOr(definition.setup),
          layerFor: (settings) =>
            decodeSettings(settings).pipe(
              Effect.mapError(
                (issue) => new InvalidPluginSettings({ plugin: name, message: issue.message }),
              ),
              Effect.flatMap((settingsValue) => {
                const layer = definition.layer(settingsValue);

                return isPluginLayer(layer)
                  ? Effect.succeed(layer)
                  : Effect.die(`Plugin ${name} did not return a Layer`);
              }),
            ),
        };

        return plugin;
      });

      const uninstall = (name: PluginName) =>
        files.remove(NodePath.join(home.pluginsDir, name)).pipe(Effect.mapError(failWith(name)));

      return { install, load, uninstall };
    }),
  );
}
