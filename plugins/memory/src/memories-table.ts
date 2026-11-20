import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@caw/sdk/plugin";

export const memoriesTable = sqliteTable("plugin_memory_memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope", { enum: ["global", "conversation"] }).notNull(),
  /** The top-level Conversation; null exactly when `scope` is `global`. */
  conversationId: text("conversation_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull(),
  /** Epoch milliseconds. */
  createdAt: integer("created_at").notNull(),
  /** Epoch milliseconds of the last save, update or read. */
  lastUsedAt: integer("last_used_at").notNull(),
});

export const memoryMigrations: ReadonlyArray<Migration> = [
  {
    id: 1,
    name: "create_memories",
    run: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE IF NOT EXISTS plugin_memory_memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL CHECK (scope IN ('global', 'conversation')),
          conversation_id TEXT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          pinned INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL,
          CHECK ((scope = 'global') = (conversation_id IS NULL))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS plugin_memory_memories_conversation
        ON plugin_memory_memories (conversation_id)
      `;
    }),
  },
];
