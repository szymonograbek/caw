import type { ConversationPlace } from "@gloaming/caw-plugin-sdk/channel";
import type { ReplyMode } from "@gloaming/caw-plugin-sdk/conversation";
import { Conversation } from "@gloaming/caw-plugin-sdk/conversation";
import { CawEvent } from "@gloaming/caw-plugin-sdk/events";
import type {
  ChannelName,
  ConversationId,
  ExternalConversationId,
} from "@gloaming/caw-plugin-sdk/ids";
import { Context, Effect, Layer, Match, Option } from "effect";
import { EventBus } from "../events/event-bus.ts";
import { Conversations } from "../store/conversations.ts";
import { newConversationId } from "../store/new-ids.ts";

/** Finds or creates the Conversation behind a Channel place. */
export class ConversationPlaces extends Context.Service<
  ConversationPlaces,
  {
    /** DMs are always `inline`, Rooms start `threaded`, threads belong to their parent Room. */
    readonly resolve: (
      channel: ChannelName,
      externalId: ExternalConversationId,
      place: ConversationPlace,
    ) => Effect.Effect<Conversation>;
    /** The top-level Conversation that owns the Workspace and profile. */
    readonly root: (conversation: Conversation) => Effect.Effect<Conversation>;
  }
>()("@caw/core/ConversationPlaces") {
  static readonly layer = Layer.effect(
    ConversationPlaces,
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      const bus = yield* EventBus;

      const findOrCreate = Effect.fn("ConversationPlaces.findOrCreate")(function* (
        channel: ChannelName,
        externalId: ExternalConversationId,
        parentId: Option.Option<ConversationId>,
        replyMode: ReplyMode,
      ) {
        const existing = yield* conversations.find(channel, externalId);

        if (Option.isSome(existing)) {
          return existing.value;
        }

        const conversation = new Conversation({
          id: yield* newConversationId,
          channel,
          externalId,
          parentId,
          replyMode,
          profile: Option.none(),
        });

        yield* conversations.insert(conversation);
        yield* bus.publish(CawEvent.ConversationCreated({ conversation }));

        return conversation;
      });

      const resolve = (
        channel: ChannelName,
        externalId: ExternalConversationId,
        place: ConversationPlace,
      ): Effect.Effect<Conversation> =>
        Match.valueTags(place, {
          Direct: () => findOrCreate(channel, externalId, Option.none(), "inline"),
          Room: () => findOrCreate(channel, externalId, Option.none(), "threaded"),
          Thread: ({ parent }) =>
            Effect.flatMap(findOrCreate(channel, parent, Option.none(), "threaded"), (room) =>
              findOrCreate(channel, externalId, Option.some(room.id), "inline"),
            ),
        });

      const root = (conversation: Conversation): Effect.Effect<Conversation> =>
        Option.match(conversation.parentId, {
          onNone: () => Effect.succeed(conversation),
          onSome: (parentId) =>
            Effect.flatMap(conversations.get(parentId), (parent) =>
              Option.match(parent, {
                onNone: () => Effect.die(`Conversation ${conversation.id} lost its parent`),
                onSome: root,
              }),
            ),
        });

      return { resolve, root };
    }),
  );
}
