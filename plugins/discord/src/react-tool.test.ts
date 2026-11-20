import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import { Conversation } from "@caw/sdk/conversation";
import type { ConversationId, ExternalConversationId } from "@caw/sdk/ids";
import {
  ChannelName,
  ConversationId as Id,
  ExternalConversationId as ExternalId,
  SessionId,
} from "@caw/sdk/ids";
import { ConversationNotFound } from "@caw/sdk/plugin";
import { MessageNotFound } from "./discord-client.ts";
import { reactTool } from "./react-tool.ts";

const parent = new Conversation({
  id: Id.make("parent"),
  channel: ChannelName.make("discord"),
  externalId: ExternalId.make("parent-channel"),
  parentId: Option.none(),
  replyMode: "threaded",
  profile: Option.none(),
});

const thread = new Conversation({
  id: Id.make("thread"),
  channel: parent.channel,
  replyMode: "threaded",
  profile: Option.none(),
  externalId: ExternalId.make("thread-channel"),
  parentId: Option.some(parent.id),
});

const conversations = new Map(
  [parent, thread].map((conversation) => [conversation.id, conversation]),
);

/** A fake Discord where each message exists in exactly one channel; records reactions made. */
const setup = (messageLivesIn: ExternalConversationId) => {
  const reactions: Array<string> = [];

  const tool = reactTool({
    allowedReactions: ["✅", "👀"],
    conversation: (id: ConversationId) =>
      Effect.fromOption(Option.fromNullishOr(conversations.get(id))).pipe(
        Effect.mapError(() => new ConversationNotFound({ conversationId: id })),
      ),
    react: (conversation, message, emoji) =>
      conversation === messageLivesIn
        ? Effect.sync(() => {
            reactions.push(`${conversation}/${message}/${emoji}`);
          })
        : Effect.fail(new MessageNotFound({ messageId: message })),
  });

  const run = (conversationId: ConversationId, input: { messageId: string; emoji: string }) =>
    tool.run(input, {
      conversationId,
      rootConversationId: parent.id,
      sessionId: SessionId.make("s"),
    });

  return { reactions, run };
};

describe("react tool", () => {
  it.effect("reacts with an allowed emoji in the caller's Conversation", () =>
    Effect.gen(function* () {
      const { reactions, run } = setup(parent.externalId);
      const result = yield* run(parent.id, { messageId: "m1", emoji: "✅" });

      expect(result).toBe("Reacted ✅");
      expect(reactions).toEqual(["parent-channel/m1/✅"]);
    }),
  );

  it.effect("rejects an emoji outside the allowed list without reacting", () =>
    Effect.gen(function* () {
      const { reactions, run } = setup(parent.externalId);
      const exit = yield* Effect.exit(run(parent.id, { messageId: "m1", emoji: "💩" }));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(reactions).toEqual([]);
    }),
  );

  it.effect("finds a message from a thread in its parent channel", () =>
    Effect.gen(function* () {
      const { reactions, run } = setup(parent.externalId);

      yield* run(thread.id, { messageId: "m1", emoji: "👀" });

      expect(reactions).toEqual(["parent-channel/m1/👀"]);
    }),
  );

  it.effect("reports a message missing from a top-level Conversation", () =>
    Effect.gen(function* () {
      const { run } = setup(ExternalId.make("elsewhere"));
      const error = yield* Effect.flip(run(parent.id, { messageId: "m1", emoji: "✅" }));

      expect(error.message).toBe("Message m1 not found in this Conversation");
    }),
  );
});
