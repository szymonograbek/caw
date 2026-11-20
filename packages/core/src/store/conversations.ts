import { Conversation, ReplyMode } from "@gloaming/caw-plugin-sdk/conversation";
import {
  ChannelName,
  ConversationId,
  ExternalConversationId,
  ProfileName,
} from "@gloaming/caw-plugin-sdk/ids";
import { and, eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Database } from "./database.ts";

const conversationsTable = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  externalId: text("external_id").notNull(),
  parentId: text("parent_id"),
  replyMode: text("reply_mode").notNull(),
  profile: text("profile"),
  settingsJson: text("settings_json").notNull().default("{}"),
});

const ConversationRow = Schema.Struct({
  id: ConversationId,
  channel: ChannelName,
  externalId: ExternalConversationId,
  parentId: Schema.OptionFromNullOr(ConversationId),
  replyMode: ReplyMode,
  profile: Schema.OptionFromNullOr(ProfileName),
});

const decodeRow = Schema.decodeUnknownEffect(ConversationRow);

const toConversation = (row: typeof conversationsTable.$inferSelect) =>
  decodeRow(row).pipe(
    Effect.map((fields) => new Conversation(fields)),
    Effect.orDie,
  );

const firstConversation = (rows: ReadonlyArray<typeof conversationsTable.$inferSelect>) =>
  Option.match(Option.fromNullishOr(rows[0]), {
    onNone: () => Effect.succeedNone,
    onSome: (row) => Effect.asSome(toConversation(row)),
  });

/** The `conversations` table: one row per Channel place Caw has seen. */
export class Conversations extends Context.Service<
  Conversations,
  {
    readonly get: (id: ConversationId) => Effect.Effect<Option.Option<Conversation>>;
    readonly find: (
      channel: ChannelName,
      externalId: ExternalConversationId,
    ) => Effect.Effect<Option.Option<Conversation>>;
    readonly insert: (conversation: Conversation) => Effect.Effect<void>;
    readonly setProfile: (
      id: ConversationId,
      profile: Option.Option<ProfileName>,
    ) => Effect.Effect<void>;
    readonly setReplyMode: (id: ConversationId, replyMode: ReplyMode) => Effect.Effect<void>;
  }
>()("@caw/core/Conversations") {
  static readonly layer = Layer.effect(
    Conversations,
    Effect.gen(function* () {
      const db = yield* Database;

      return {
        get: Effect.fn("Conversations.get")(function* (id: ConversationId) {
          const rows = yield* db
            .select()
            .from(conversationsTable)
            .where(eq(conversationsTable.id, id))
            .pipe(Effect.orDie);

          return yield* firstConversation(rows);
        }),
        find: Effect.fn("Conversations.find")(function* (
          channel: ChannelName,
          externalId: ExternalConversationId,
        ) {
          const rows = yield* db
            .select()
            .from(conversationsTable)
            .where(
              and(
                eq(conversationsTable.channel, channel),
                eq(conversationsTable.externalId, externalId),
              ),
            )
            .pipe(Effect.orDie);

          return yield* firstConversation(rows);
        }),
        insert: Effect.fn("Conversations.insert")(function* (conversation: Conversation) {
          yield* db
            .insert(conversationsTable)
            .values({
              id: conversation.id,
              channel: conversation.channel,
              externalId: conversation.externalId,
              parentId: Option.getOrNull(conversation.parentId),
              replyMode: conversation.replyMode,
              profile: Option.getOrNull(conversation.profile),
            })
            .pipe(Effect.orDie);
        }),
        setProfile: Effect.fn("Conversations.setProfile")(function* (
          id: ConversationId,
          profile: Option.Option<ProfileName>,
        ) {
          yield* db
            .update(conversationsTable)
            .set({ profile: Option.getOrNull(profile) })
            .where(eq(conversationsTable.id, id))
            .pipe(Effect.orDie);
        }),
        setReplyMode: Effect.fn("Conversations.setReplyMode")(function* (
          id: ConversationId,
          replyMode: ReplyMode,
        ) {
          yield* db
            .update(conversationsTable)
            .set({ replyMode })
            .where(eq(conversationsTable.id, id))
            .pipe(Effect.orDie);
        }),
      };
    }),
  );
}
