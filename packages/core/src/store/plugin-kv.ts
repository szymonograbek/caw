import type { PluginName } from "@gloaming/sdk/ids";
import { and, eq } from "drizzle-orm";
import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Context, Effect, Layer, Option } from "effect";
import { Database } from "./database.ts";

const pluginKvTable = sqliteTable(
  "plugin_kv",
  {
    plugin: text("plugin").notNull(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.plugin, table.key] })],
);

/** The `plugin_kv` table: each Plugin's key-value store, holding JSON text. */
export class PluginKv extends Context.Service<
  PluginKv,
  {
    readonly get: (plugin: PluginName, key: string) => Effect.Effect<Option.Option<string>>;
    readonly set: (plugin: PluginName, key: string, valueJson: string) => Effect.Effect<void>;
  }
>()("@gloaming/core/PluginKv") {
  static readonly layer = Layer.effect(
    PluginKv,
    Effect.gen(function* () {
      const db = yield* Database;

      return {
        get: Effect.fn("PluginKv.get")(function* (plugin: PluginName, key: string) {
          const rows = yield* db
            .select({ valueJson: pluginKvTable.valueJson })
            .from(pluginKvTable)
            .where(and(eq(pluginKvTable.plugin, plugin), eq(pluginKvTable.key, key)))
            .pipe(Effect.orDie);

          return Option.map(Option.fromNullishOr(rows[0]), (row) => row.valueJson);
        }),
        set: Effect.fn("PluginKv.set")(function* (
          plugin: PluginName,
          key: string,
          valueJson: string,
        ) {
          yield* db
            .insert(pluginKvTable)
            .values({ plugin, key, valueJson })
            .onConflictDoUpdate({
              target: [pluginKvTable.plugin, pluginKvTable.key],
              set: { valueJson },
            })
            .pipe(Effect.orDie);
        }),
      };
    }),
  );
}
