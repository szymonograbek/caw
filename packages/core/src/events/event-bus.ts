import type { CawEvent } from "@gloaming/caw-plugin-sdk/events";
import type { PluginMessage } from "@gloaming/caw-plugin-sdk/plugin";
import { Context, Effect, Layer, PubSub, Stream } from "effect";

/** Where core announces every Event, plus the inter-plugin message bus. */
export class EventBus extends Context.Service<
  EventBus,
  {
    readonly publish: (event: CawEvent) => Effect.Effect<void>;
    /** Each subscriber gets its own unbounded queue, so a slow Plugin never blocks core. */
    readonly events: Stream.Stream<CawEvent>;
    readonly pluginMessages: PubSub.PubSub<PluginMessage>;
  }
>()("@caw/core/EventBus") {
  static readonly layer = Layer.effect(
    EventBus,
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<CawEvent>();
      const pluginMessages = yield* PubSub.unbounded<PluginMessage>();

      return {
        publish: (event) => PubSub.publish(events, event),
        events: Stream.fromPubSub(events),
        pluginMessages,
      };
    }),
  );
}
