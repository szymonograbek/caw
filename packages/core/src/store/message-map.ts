import type { ChannelMessageId, ConversationId, SessionId } from "@caw/sdk/ids";
import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Context, Effect, Layer, Option } from "effect";
import { Database } from "./database.ts";

const messageMapTable = sqliteTable(
  "message_map",
  {
    channelMessageId: text("channel_message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    sessionId: text("session_id"),
  },
  (table) => [primaryKey({ columns: [table.channelMessageId, table.conversationId] })],
);

/** Which Conversation and Session each Channel message belongs to. */
export class MessageMap extends Context.Service<
  MessageMap,
  {
    /** Records (or re-points) messages; a message gets its Session once one is chosen. */
    readonly record: (
      conversation: ConversationId,
      messages: ReadonlyArray<ChannelMessageId>,
      session: Option.Option<SessionId>,
    ) => Effect.Effect<void>;
  }
>()("@caw/core/MessageMap") {
  static readonly layer = Layer.effect(
    MessageMap,
    Effect.gen(function* () {
      const db = yield* Database;

      return {
        record: Effect.fn("MessageMap.record")(function* (
          conversation: ConversationId,
          messages: ReadonlyArray<ChannelMessageId>,
          session: Option.Option<SessionId>,
        ) {
          if (messages.length === 0) {
            return;
          }

          const sessionId = Option.getOrNull(session);

          yield* db
            .insert(messageMapTable)
            .values(
              messages.map((channelMessageId) => ({
                channelMessageId,
                conversationId: conversation,
                sessionId,
              })),
            )
            .onConflictDoUpdate({
              target: [messageMapTable.channelMessageId, messageMapTable.conversationId],
              set: { sessionId },
            })
            .pipe(Effect.orDie);
        }),
      };
    }),
  );
}
