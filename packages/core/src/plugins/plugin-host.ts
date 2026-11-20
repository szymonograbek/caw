import { CawEvent } from "@gloaming/sdk/events";
import type { PluginName } from "@gloaming/sdk/ids";
import { Cause, Context, Effect, Exit, Layer, Option, Predicate, Ref, Schema, Scope } from "effect";
import { EventBus } from "../events/event-bus.ts";
import { SessionPool } from "../sessions/session-pool.ts";
import type { PluginRow } from "../store/plugin-rows.ts";
import { PluginRows } from "../store/plugin-rows.ts";
import type { InvalidPluginSettings, LoadedPlugin } from "./loaded-plugin.ts";
import type { PluginInstallError } from "./plugin-installer.ts";
import { PluginInstaller } from "./plugin-installer.ts";
import { PluginScopes } from "./plugin-scopes.ts";
import { PluginState } from "./plugin-state.ts";
import { Registration, Registry } from "./registry.ts";

export class PluginNotFound extends Schema.TaggedError<
  PluginNotFound,
  { readonly brand: unique symbol }
>()("PluginNotFound", { plugin: Schema.String }) {}

export class BuiltinPluginNotRemovable extends Schema.TaggedError<
  BuiltinPluginNotRemovable,
  { readonly brand: unique symbol }
>()("BuiltinPluginNotRemovable", { plugin: Schema.String }) {}

/** One line for `caw status`: the error's message, without its stack. */
const failureSummary = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);

  return (Predicate.isError(error) ? `${error.name}: ${error.message}` : String(error))
    .replace(/\s+/g, " ")
    .trim();
};

/** An installed Plugin and what it is doing now. */
export interface PluginEntry {
  readonly row: PluginRow;
  readonly state: PluginState;
}

/**
 * Runs each enabled Plugin's layer in its own scope, in Plugin order.
 * Disabling a Plugin, or changing its settings, closes that scope.
 */
export class PluginHost extends Context.Service<
  PluginHost,
  {
    /** Records new built-ins (enabled, last in order), loads installed ones, starts every enabled one. */
    readonly start: (builtins: ReadonlyArray<LoadedPlugin>) => Effect.Effect<void>;
    /** Every installed Plugin, in Plugin order. */
    readonly list: Effect.Effect<ReadonlyArray<PluginEntry>>;
    /** Installs an external Plugin (`caw plugin add`), enabled and last in order. */
    readonly install: (source: string) => Effect.Effect<PluginName, PluginInstallError>;
    readonly enable: (name: PluginName) => Effect.Effect<void, PluginNotFound>;
    readonly disable: (name: PluginName) => Effect.Effect<void, PluginNotFound>;
    /** Stops and uninstalls an external Plugin. */
    readonly remove: (
      name: PluginName,
    ) => Effect.Effect<void, PluginNotFound | BuiltinPluginNotRemovable | PluginInstallError>;
    /** Moves `first` to the front of Plugin order, in that order; the rest keep theirs. */
    readonly order: (first: ReadonlyArray<PluginName>) => Effect.Effect<void, PluginNotFound>;
    readonly configure: (
      name: PluginName,
      settings: Schema.Json,
    ) => Effect.Effect<void, PluginNotFound | InvalidPluginSettings>;
  }
>()("@gloaming/core/PluginHost") {
  static readonly layer = Layer.effect(
    PluginHost,
    Effect.gen(function* () {
      const rows = yield* PluginRows;
      const installer = yield* PluginInstaller;
      const registry = yield* Registry;
      const scopes = yield* PluginScopes;
      const bus = yield* EventBus;
      const pool = yield* SessionPool;
      const layerScope = yield* Effect.scope;
      const pluginsScope = yield* Scope.fork(layerScope);
      const known = yield* Ref.make(new Map<PluginName, LoadedPlugin>());
      const running = yield* Ref.make(new Map<PluginName, Scope.Closeable>());
      /** Why each enabled Plugin that is not running failed to start. */
      const failures = yield* Ref.make(new Map<PluginName, string>());

      const recordFailure = (name: PluginName, message: string) =>
        Ref.update(failures, (all) => new Map(all).set(name, message));

      const clearFailure = (name: PluginName) =>
        Ref.update(failures, (all) => {
          const next = new Map(all);

          next.delete(name);

          return next;
        });

      // Sessions close before the Plugins (their Harness and Channel) they run on.
      yield* Effect.addFinalizer(() => pool.closeAll("shutdown"));

      const syncOrder = Effect.flatMap(rows.list, (all) =>
        registry.setOrder(all.map((row) => row.name)),
      );

      const run = Effect.fn("PluginHost.run")(function* (plugin: LoadedPlugin, row: PluginRow) {
        yield* clearFailure(plugin.name);

        const layer = yield* plugin.layerFor(row.settings);
        const scope = yield* Scope.fork(pluginsScope);

        yield* Option.match(plugin.skillDir, {
          onNone: () => Effect.void,
          onSome: (path) =>
            registry
              .add(Registration.SkillDir({ plugin: plugin.name, path }))
              .pipe(Scope.provide(scope)),
        });

        const built = yield* scopes.launch(plugin, layer, scope).pipe(Effect.exit);

        if (Exit.isFailure(built)) {
          yield* Scope.close(scope, built);
          yield* recordFailure(plugin.name, failureSummary(built.cause));
          yield* Effect.logError("Plugin failed to start", Cause.pretty(built.cause));

          return;
        }

        yield* Ref.update(running, (all) => new Map(all).set(plugin.name, scope));
        yield* bus.publish(CawEvent.PluginEnabled({ plugin: plugin.name }));
      });

      const startRow = (row: PluginRow) =>
        Effect.gen(function* () {
          const plugin = (yield* Ref.get(known)).get(row.name);

          if (plugin === undefined) {
            yield* Effect.logWarning("Enabled Plugin is not installed");

            return;
          }

          yield* run(plugin, row).pipe(
            Effect.catchTag("InvalidPluginSettings", (error) =>
              Effect.andThen(
                recordFailure(row.name, `Invalid settings: ${error.message}`),
                Effect.logError("Plugin settings are invalid", error.message),
              ),
            ),
          );
        }).pipe(Effect.annotateLogs({ plugin: row.name }));

      const stop = Effect.fn("PluginHost.stop")(function* (name: PluginName) {
        yield* clearFailure(name);

        const scope = (yield* Ref.get(running)).get(name);

        if (scope === undefined) {
          return;
        }

        yield* Ref.update(running, (all) => {
          const next = new Map(all);

          next.delete(name);

          return next;
        });
        yield* Scope.close(scope, Exit.void);
        yield* bus.publish(CawEvent.PluginDisabled({ plugin: name }));
      });

      const rowOf = (name: PluginName) =>
        rows.get(name).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() => new PluginNotFound({ plugin: name })),
        );

      const stateOf = Effect.fn("PluginHost.stateOf")(function* (row: PluginRow) {
        if (!row.enabled) {
          return PluginState.cases.Disabled.make({});
        }

        if ((yield* Ref.get(running)).has(row.name)) {
          return PluginState.cases.Running.make({});
        }

        const failure = (yield* Ref.get(failures)).get(row.name);

        return failure === undefined
          ? PluginState.cases.Missing.make({})
          : PluginState.cases.Failed.make({ message: failure });
      });

      /** Tools and prompts are fixed per live Session, so changed Plugins close them all. */
      const pluginsChanged = pool.closeAll("plugins-changed");

      return {
        start: Effect.fn("PluginHost.start")(function* (builtins: ReadonlyArray<LoadedPlugin>) {
          yield* Effect.forEach(builtins, (plugin) => rows.add(plugin.name, "builtin", "builtin"));
          yield* syncOrder;

          const all = yield* rows.list;

          const external = yield* Effect.forEach(
            all.filter((row) => row.source !== "builtin"),
            (row) =>
              installer.load(row.name).pipe(
                Effect.asSome,
                Effect.catchTag("PluginInstallError", (error) =>
                  Effect.as(
                    Effect.logError("Loading an installed Plugin failed", error),
                    Option.none(),
                  ),
                ),
              ),
          );

          yield* Ref.set(
            known,
            new Map(
              [...builtins, ...external.flatMap(Option.toArray)].map((plugin) => [
                plugin.name,
                plugin,
              ]),
            ),
          );

          yield* Effect.forEach(
            all.filter((row) => row.enabled),
            startRow,
          );
        }),
        list: Effect.flatMap(rows.list, (all) =>
          Effect.forEach(all, (row) => Effect.map(stateOf(row), (state) => ({ row, state }))),
        ),
        install: Effect.fn("PluginHost.install")(function* (source: string) {
          const installed = yield* installer.install(source);
          const plugin = yield* installer.load(installed.name);

          yield* stop(installed.name);
          yield* Ref.update(known, (all) => new Map(all).set(plugin.name, plugin));
          yield* rows.add(installed.name, source, installed.version);
          yield* syncOrder;
          yield* pluginsChanged;
          yield* Effect.flatMap(rowOf(installed.name), startRow).pipe(Effect.orDie);

          return installed.name;
        }),
        enable: Effect.fn("PluginHost.enable")(function* (name: PluginName) {
          const row = yield* rowOf(name);

          yield* rows.setEnabled(name, true);
          yield* stop(name);
          yield* pluginsChanged;
          yield* startRow(row);
        }),
        disable: Effect.fn("PluginHost.disable")(function* (name: PluginName) {
          yield* rowOf(name);
          yield* rows.setEnabled(name, false);
          yield* pluginsChanged;
          yield* stop(name);
        }),
        remove: Effect.fn("PluginHost.remove")(function* (name: PluginName) {
          const row = yield* rowOf(name);

          if (row.source === "builtin") {
            return yield* new BuiltinPluginNotRemovable({ plugin: name });
          }

          yield* pluginsChanged;
          yield* stop(name);
          yield* rows.remove(name);
          yield* Ref.update(known, (all) => {
            const next = new Map(all);

            next.delete(name);

            return next;
          });
          yield* syncOrder;

          return yield* installer.uninstall(name);
        }),
        order: Effect.fn("PluginHost.order")(function* (first: ReadonlyArray<PluginName>) {
          yield* Effect.forEach(first, rowOf);

          const rest = (yield* rows.list)
            .map((row) => row.name)
            .filter((name) => !first.includes(name));

          yield* rows.setOrder([...first, ...rest]);
          yield* syncOrder;
          yield* pluginsChanged;
        }),
        configure: Effect.fn("PluginHost.configure")(function* (
          name: PluginName,
          settings: Schema.Json,
        ) {
          const row = yield* rowOf(name);
          const plugin = (yield* Ref.get(known)).get(name);

          if (plugin !== undefined) {
            yield* plugin.layerFor(settings);
          }

          yield* rows.setSettings(name, settings);

          if (row.enabled) {
            yield* pluginsChanged;
            yield* stop(name);
            yield* Effect.flatMap(rowOf(name), startRow);
          }
        }),
      };
    }),
  );
}
