import type { Channel } from "@omen/sdk/channel";
import type { Harness } from "@omen/sdk/harness";
import type { ChannelName, HarnessName, PluginName } from "@omen/sdk/ids";
import type { Interceptor } from "@omen/sdk/interceptors";
import type { CliCommand, ProfileLookup } from "@omen/sdk/plugin";
import type { Tool } from "@omen/sdk/tool";
import type { Scope } from "effect";
import { Array, Context, Data, Effect, Layer, Option, Order, Ref } from "effect";

/** Something a Plugin registered; it lasts as long as the Plugin stays enabled. */
export type Registration = Data.TaggedEnum<{
  Channel: { readonly plugin: PluginName; readonly channel: Channel };
  Harness: { readonly plugin: PluginName; readonly harness: Harness };
  Tool: { readonly plugin: PluginName; readonly tool: Tool };
  Interceptor: { readonly plugin: PluginName; readonly interceptor: Interceptor };
  CliCommand: { readonly plugin: PluginName; readonly command: CliCommand };
  Profiles: { readonly plugin: PluginName; readonly lookup: ProfileLookup };
  /** A Plugin's agent skill directory, loaded into every Session that opens. */
  SkillDir: { readonly plugin: PluginName; readonly path: string };
}>;

export const Registration = Data.taggedEnum<Registration>();

/**
 * What enabled Plugins registered, read in Plugin order. Each entry is removed
 * when the scope it was registered in closes.
 */
export class Registry extends Context.Service<
  Registry,
  {
    readonly add: (registration: Registration) => Effect.Effect<void, never, Scope.Scope>;
    /** Every registration in Plugin order (registration order within a Plugin). */
    readonly all: Effect.Effect<ReadonlyArray<Registration>>;
    readonly setOrder: (order: ReadonlyArray<PluginName>) => Effect.Effect<void>;
    readonly channel: (name: ChannelName) => Effect.Effect<Option.Option<Channel>>;
    /** The named Harness; the first registered one stands in when `name` is `None`. */
    readonly harness: (name: Option.Option<HarnessName>) => Effect.Effect<Option.Option<Harness>>;
    readonly cliCommand: (name: string) => Effect.Effect<Option.Option<CliCommand>>;
  }
>()("@omen/core/Registry") {
  static readonly layer = Layer.effect(
    Registry,
    Effect.gen(function* () {
      const registrations = yield* Ref.make<ReadonlyArray<Registration>>([]);
      const pluginOrder = yield* Ref.make<ReadonlyArray<PluginName>>([]);

      const all = Effect.gen(function* () {
        const entries = yield* Ref.get(registrations);
        const order = yield* Ref.get(pluginOrder);

        const rank = (entry: Registration) => {
          const index = order.indexOf(entry.plugin);

          return index === -1 ? order.length : index;
        };

        return Array.sort(entries, Order.mapInput(Order.Number, rank));
      });

      const channels = Effect.map(all, Array.filter(Registration.$is("Channel")));
      const harnesses = Effect.map(all, Array.filter(Registration.$is("Harness")));
      const commands = Effect.map(all, Array.filter(Registration.$is("CliCommand")));

      return {
        add: (registration) =>
          Effect.acquireRelease(
            Ref.update(registrations, (entries) => [...entries, registration]),
            () =>
              Ref.update(registrations, (entries) =>
                entries.filter((entry) => entry !== registration),
              ),
          ),
        all,
        setOrder: (order) => Ref.set(pluginOrder, order),
        channel: (name) =>
          Effect.map(channels, (entries) =>
            Option.map(
              Array.findFirst(entries, (entry) => entry.channel.name === name),
              (entry) => entry.channel,
            ),
          ),
        harness: (name) =>
          Effect.map(harnesses, (entries) =>
            Option.map(
              Option.match(name, {
                onNone: () => Array.head(entries),
                onSome: (wanted) =>
                  Array.findFirst(entries, (entry) => entry.harness.name === wanted),
              }),
              (entry) => entry.harness,
            ),
          ),
        cliCommand: (name) =>
          Effect.map(commands, (entries) =>
            Option.map(
              Array.findFirst(entries, (entry) => entry.command.name === name),
              (entry) => entry.command,
            ),
          ),
      };
    }),
  );
}
