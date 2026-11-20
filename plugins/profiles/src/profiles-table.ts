import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@omen/sdk/plugin";

export const profilesTable = sqliteTable("plugin_profiles_profiles", {
  name: text("name").primaryKey(),
  harness: text("harness").notNull(),
  /** JSON object of environment variables. */
  env: text("env_json").notNull(),
  model: text("model"),
  cwd: text("cwd"),
  /** JSON array; null means the Harness default. */
  settingSources: text("setting_sources_json"),
});

export const profilesMigrations: ReadonlyArray<Migration> = [
  {
    id: 1,
    name: "create_profiles",
    run: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TABLE IF NOT EXISTS plugin_profiles_profiles (
          name TEXT PRIMARY KEY NOT NULL,
          harness TEXT NOT NULL,
          env_json TEXT NOT NULL,
          model TEXT,
          cwd TEXT,
          setting_sources_json TEXT
        )
      `;
    }),
  },
];
