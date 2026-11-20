import * as Migrator from "@effect/sql-sqlite-bun/SqliteMigrator";
import type { Migration } from "@caw/sdk/plugin";
import type { PluginName } from "@caw/sdk/ids";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

const initial = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    external_id TEXT NOT NULL,
    parent_id TEXT REFERENCES conversations (id),
    reply_mode TEXT NOT NULL CHECK (reply_mode IN ('threaded', 'inline')),
    profile TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (channel, external_id)
  )`;
  yield* sql`CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations (id),
    harness TEXT NOT NULL,
    profile TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('live', 'idle', 'lost', 'closed')),
    resume_cursor_json TEXT,
    runtime_payload_json TEXT,
    forked_from_session_id TEXT REFERENCES sessions (id),
    last_seen_at INTEGER NOT NULL
  )`;
  yield* sql`CREATE INDEX sessions_by_conversation ON sessions (conversation_id, last_seen_at)`;
  yield* sql`CREATE TABLE message_map (
    channel_message_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations (id),
    session_id TEXT REFERENCES sessions (id),
    PRIMARY KEY (channel_message_id, conversation_id)
  )`;
  yield* sql`CREATE TABLE plugins (
    name TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    version TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    settings_json TEXT NOT NULL DEFAULT '{}'
  )`;
  yield* sql`CREATE TABLE plugin_kv (
    plugin TEXT NOT NULL REFERENCES plugins (name) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (plugin, key)
  )`;
});

/** Core's numbered migrations; the Migrator records each in `effect_sql_migrations`. */
export const runCoreMigrations = Migrator.run({
  loader: Migrator.fromRecord({ "1_initial": initial }),
});

/** Runs a Plugin's migrations, recorded in its own `plugin_<name>_migrations` table. */
export const runPluginMigrations = (plugin: PluginName, migrations: ReadonlyArray<Migration>) =>
  Migrator.run({
    loader: Effect.succeed(
      migrations.map(
        (migration) => [migration.id, migration.name, Effect.succeed(migration.run)] as const,
      ),
    ),
    table: `plugin_${plugin}_migrations`,
  });
