import { SqliteClient } from "@effect/sql-sqlite-bun";
import { describe, expect, it } from "@effect/vitest";
import { sql } from "drizzle-orm";
import * as SqliteDrizzle from "drizzle-orm/effect-sqlite-bun";
import { Effect } from "effect";

describe("sqlite under the test runner", () => {
  it.effect("runs a drizzle query over bun:sqlite", () =>
    Effect.gen(function* () {
      const db = yield* SqliteDrizzle.makeWithDefaults();
      const row = yield* db.get<{ one: number }>(sql`select 1 as one`);

      expect(row).toEqual({ one: 1 });
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
});
