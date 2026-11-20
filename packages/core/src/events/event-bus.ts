import type { OmenEvent } from "@omen/sdk/events";
import type { PluginMessage } from "@omen/sdk/plugin";
import { Context, Effect, Layer, PubSub, Stream } from "effect";

/** Where core announces every Event, plus the inter-plugin message bus. */
export class EventBus extends Context.Service<
  EventBus,
  {
    readonly publish: (event: OmenEvent) => Effect.Effect<void>;
    /** Each subscriber gets its own unbounded queue, so a slow Plugin never blocks core. */
    readonly events: Stream.Stream<OmenEvent>;
    readonly pluginMessages: PubSub.PubSub<PluginMessage>;
  }
>()("@omen/core/EventBus") {
  static readonly layer = Layer.effect(
    EventBus,
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<OmenEvent>();
      const pluginMessages = yield* PubSub.unbounded<PluginMessage>();

      return {
        publish: (event) => PubSub.publish(events, event),
        events: Stream.fromPubSub(events),
        pluginMessages,
      };
    }),
  );
}
