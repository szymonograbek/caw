import type { PluginName } from "@gloaming/caw-plugin-sdk/ids";
import type {
  GuidePage,
  Migration,
  PluginDefinition,
  PluginServices,
} from "@gloaming/caw-plugin-sdk/plugin";
import type { PluginSetup } from "@gloaming/caw-plugin-sdk/setup";
import type { Layer } from "effect";
import { Effect, Option, Schema } from "effect";

export class InvalidPluginSettings extends Schema.TaggedError<
  InvalidPluginSettings,
  { readonly brand: unique symbol }
>()("InvalidPluginSettings", {
  plugin: Schema.String,
  message: Schema.String,
}) {}

/**
 * A Plugin with its settings type erased: core only ever hands it the stored
 * settings JSON, which the Plugin's own schema decodes.
 */
export interface LoadedPlugin {
  readonly name: PluginName;
  readonly migrations: ReadonlyArray<Migration>;
  readonly guide: ReadonlyArray<GuidePage>;
  readonly skillDir: Option.Option<string>;
  /** Its part in `caw install`; `None` for a feature Plugin. */
  readonly setup: Option.Option<PluginSetup>;
  readonly layerFor: (
    settings: Schema.Json,
  ) => Effect.Effect<Layer.Layer<never, never, PluginServices>, InvalidPluginSettings>;
}

/** Erases a definition's settings type so built-ins of different Plugins fit one list. */
export const fromDefinition = <Settings>(definition: PluginDefinition<Settings>): LoadedPlugin => {
  const decode = Schema.decodeUnknownEffect(definition.settings);

  return {
    name: definition.name,
    migrations: definition.migrations,
    guide: definition.guide,
    skillDir: definition.skillDir,
    setup: Option.fromNullishOr(definition.setup),
    layerFor: (settings) =>
      decode(settings).pipe(
        Effect.mapError(
          (issue) => new InvalidPluginSettings({ plugin: definition.name, message: issue.message }),
        ),
        Effect.map(definition.layer),
      ),
  };
};
