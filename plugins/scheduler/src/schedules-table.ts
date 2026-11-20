import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@gloaming/caw-plugin-sdk/plugin";

export const schedulesTable = sqliteTable("plugin_scheduler_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull(),
  kind: text("kind", { enum: ["cron", "once"] }).notNull(),
  /** Set exactly when `kind` is `cron`. */
  cron: text("cron"),
  /** Epoch milliseconds; set exactly when `kind` is `once`. */
  runAt: integer("run_at"),
  timeZone: text("timezone").notNull(),
  prompt: text("prompt").notNull(),
  /** Epoch milliseconds. */
  nextRunAt: integer("next_run_at").notNull(),
  /** Epoch milliseconds. */
  lastRunAt: integer("last_run_at"),
  /** Epoch milliseconds. */
  createdAt: integer("created_at").notNull(),
});

export const schedulerMigrations: ReadonlyArray<Migration> = [
  {
    id: 1,
    name: "create_schedules",
    run: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE IF NOT EXISTS plugin_scheduler_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('cron', 'once')),
          cron TEXT,
          run_at INTEGER,
          timezone TEXT NOT NULL,
          prompt TEXT NOT NULL,
          next_run_at INTEGER NOT NULL,
          last_run_at INTEGER,
          created_at INTEGER NOT NULL,
          CHECK ((kind = 'cron') = (cron IS NOT NULL)),
          CHECK ((kind = 'once') = (run_at IS NOT NULL))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS plugin_scheduler_schedules_next_run
        ON plugin_scheduler_schedules (next_run_at)
      `;
    }),
  },
];
