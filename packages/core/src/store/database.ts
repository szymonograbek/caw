import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as SqliteDrizzle from "drizzle-orm/effect-sqlite-bun";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { runCoreMigrations } from "./migrations.ts";

/** Drizzle over Caw's sqlite database, migrated before first use. */
export class Database extends Context.Service<Database, SqliteDrizzle.EffectSQLiteBunDatabase>()(
  "@caw/core/Database",
) {
  static readonly layer = Layer.effect(Database, SqliteDrizzle.makeWithDefaults());
}

const prepare = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`PRAGMA foreign_keys = ON`;
    yield* sql`PRAGMA synchronous = NORMAL`;
    yield* runCoreMigrations;
  }).pipe(Effect.orDie),
);

/**
 * The sqlite file (WAL, 5 s busy timeout by default), its pragmas and core
 * migrations, plus Drizzle on top. Also exposes the `SqlClient` Plugins need.
 */
export const storeLayer = (filename: string) =>
  Layer.mergeAll(Database.layer, prepare).pipe(
    Layer.provideMerge(SqliteClient.layer({ filename }).pipe(Layer.orDie)),
  );
