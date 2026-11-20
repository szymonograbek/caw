import { Schema } from "effect";

/**
 * What a Plugin is doing in the running daemon. `Failed` and `Missing` are
 * enabled Plugins that could not start; the daemon keeps running without them.
 */
export const PluginState = Schema.TaggedUnion({
  Running: {},
  Failed: { message: Schema.String },
  /** Enabled, but its package is not installed or did not load. */
  Missing: {},
  Disabled: {},
});

export type PluginState = typeof PluginState.Type;

/** One line for `caw status` and `caw plugin list`. */
export const describePluginState = (state: PluginState): string =>
  PluginState.match(state, {
    Running: () => "running",
    Failed: ({ message }) => `failed: ${message}`,
    Missing: () => "enabled, but not installed",
    Disabled: () => "disabled",
  });
