import { Effect, Option, Schema } from "effect";
import type { ChannelError } from "@gloaming/sdk/channel";
import type { Caw } from "@gloaming/sdk/plugin";
import type { ExternalConversationId } from "@gloaming/sdk/ids";
import { ChannelMessageId } from "@gloaming/sdk/ids";
import type { Tool } from "@gloaming/sdk/tool";
import { makeTool, ToolError } from "@gloaming/sdk/tool";
import type { MessageNotFound } from "./discord-client.ts";

const ReactParameters = Schema.Struct({
  messageId: Schema.String.annotate({ description: "The Discord id of the message to react to" }),
  emoji: Schema.String.annotate({ description: "One of the allowed emoji" }),
});

/** What the react tool needs: the allowed emoji, Conversation lookup, and a reaction that reports a missing message. */
export interface ReactToolDependencies {
  readonly allowedReactions: ReadonlyArray<string>;
  readonly conversation: Caw["Service"]["conversation"];
  readonly react: (
    conversation: ExternalConversationId,
    message: ChannelMessageId,
    emoji: string,
  ) => Effect.Effect<void, ChannelError | MessageNotFound>;
}

/**
 * `react(messageId, emoji)` on the caller's Conversation. In threaded mode the
 * triggering message sits in the parent channel, so a message missing from a
 * thread is looked up in its parent.
 */
export const reactTool = (dependencies: ReactToolDependencies): Tool =>
  makeTool({
    name: "react",
    description: `React to a Discord message with an emoji. Allowed: ${dependencies.allowedReactions.join(" ")}`,
    parameters: ReactParameters,
    handler: Effect.fn("DiscordReactTool.handler")(
      function* ({ messageId, emoji }, context) {
        if (!dependencies.allowedReactions.includes(emoji)) {
          return yield* new ToolError({
            message: `${emoji} is not allowed. Use one of: ${dependencies.allowedReactions.join(" ")}`,
          });
        }

        const message = ChannelMessageId.make(messageId);
        const conversation = yield* dependencies.conversation(context.conversationId);
        const reactIn = (id: ExternalConversationId) => dependencies.react(id, message, emoji);

        yield* reactIn(conversation.externalId).pipe(
          Effect.catchTag("MessageNotFound", (notFound) =>
            Option.match(conversation.parentId, {
              onNone: () => Effect.fail(notFound),
              onSome: (parentId) =>
                dependencies
                  .conversation(parentId)
                  .pipe(Effect.flatMap((parent) => reactIn(parent.externalId))),
            }),
          ),
        );

        return `Reacted ${emoji}`;
      },
      Effect.catchTags({
        ConversationNotFound: (error) =>
          Effect.fail(new ToolError({ message: `Conversation ${error.conversationId} not found` })),
        MessageNotFound: (error) =>
          Effect.fail(
            new ToolError({ message: `Message ${error.messageId} not found in this Conversation` }),
          ),
        ChannelError: (error) =>
          Effect.fail(
            new ToolError({ message: `Discord ${error.operation} failed: ${String(error.cause)}` }),
          ),
      }),
    ),
  });
