import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Migration } from "@gloaming/caw-plugin-sdk/plugin";

export const profilesTable = sqliteTable("plugin_profiles_profiles", {
  name: text("name").primaryKey(),
  harness: text("harness").notNull(),
  /** JSON object of environment variables. */
  env: text("env_json").notNull(),
  model: text("model"),
  effort: text("effort"),
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
  {
    id: 2,
    name: "add_profiles_effort",
    run: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`ALTER TABLE plugin_profiles_profiles ADD COLUMN effort TEXT`;
    }),
  },
];
