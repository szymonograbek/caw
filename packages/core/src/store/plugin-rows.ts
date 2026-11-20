import { PluginName } from "@gloaming/sdk/ids";
import { asc, eq, max } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Database } from "./database.ts";

const pluginsTable = sqliteTable("plugins", {
  name: text("name").primaryKey(),
  source: text("source").notNull(),
  version: text("version").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  order: integer("order").notNull(),
  settingsJson: text("settings_json").notNull().default("{}"),
});

/** One installed Plugin. `source` is `builtin` or what `caw plugin add` installed from. */
export class PluginRow extends Schema.Class<PluginRow, { readonly brand: unique symbol }>(
  "PluginRow",
)({
  name: PluginName,
  source: Schema.String,
  version: Schema.String,
  enabled: Schema.Boolean,
  order: Schema.Int,
  settings: Schema.fromJsonString(Schema.Json),
}) {}

const decodeRow = Schema.decodeUnknownEffect(PluginRow);
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

/** The `plugins` table, in Plugin order. */
export class PluginRows extends Context.Service<
  PluginRows,
  {
    readonly list: Effect.Effect<ReadonlyArray<PluginRow>>;
    readonly get: (name: PluginName) => Effect.Effect<Option.Option<PluginRow>>;
    /** Adds the Plugin enabled, last in order, with default settings; keeps an existing row. */
    readonly add: (name: PluginName, source: string, version: string) => Effect.Effect<void>;
    readonly setEnabled: (name: PluginName, enabled: boolean) => Effect.Effect<void>;
    readonly setSettings: (name: PluginName, settings: Schema.Json) => Effect.Effect<void>;
    /** Gives each Plugin its position in `order`, which lists every Plugin. */
    readonly setOrder: (order: ReadonlyArray<PluginName>) => Effect.Effect<void>;
    readonly remove: (name: PluginName) => Effect.Effect<void>;
  }
>()("@gloaming/core/PluginRows") {
  static readonly layer = Layer.effect(
    PluginRows,
    Effect.gen(function* () {
      const db = yield* Database;

      const toRow = (row: typeof pluginsTable.$inferSelect) =>
        decodeRow({ ...row, settings: row.settingsJson }).pipe(Effect.orDie);

      const list = db
        .select()
        .from(pluginsTable)
        .orderBy(asc(pluginsTable.order))
        .pipe(Effect.orDie, Effect.flatMap(Effect.forEach(toRow)));

      return {
        list,
        get: Effect.fn("PluginRows.get")(function* (name: PluginName) {
          const rows = yield* db
            .select()
            .from(pluginsTable)
            .where(eq(pluginsTable.name, name))
            .pipe(Effect.orDie);

          return yield* Option.match(Option.fromNullishOr(rows[0]), {
            onNone: () => Effect.succeedNone,
            onSome: (row) => Effect.asSome(toRow(row)),
          });
        }),
        add: Effect.fn("PluginRows.add")(function* (
          name: PluginName,
          source: string,
          version: string,
        ) {
          const [last] = yield* db.select({ order: max(pluginsTable.order) }).from(pluginsTable);

          const order = (last?.order ?? -1) + 1;

          yield* db
            .insert(pluginsTable)
            .values({ name, source, version, enabled: true, order })
            .onConflictDoNothing();
        }, Effect.orDie),
        setEnabled: Effect.fn("PluginRows.setEnabled")(function* (
          name: PluginName,
          enabled: boolean,
        ) {
          yield* db
            .update(pluginsTable)
            .set({ enabled })
            .where(eq(pluginsTable.name, name))
            .pipe(Effect.orDie);
        }),
        setSettings: Effect.fn("PluginRows.setSettings")(function* (
          name: PluginName,
          settings: Schema.Json,
        ) {
          const settingsJson = yield* encodeSettings(settings);

          yield* db.update(pluginsTable).set({ settingsJson }).where(eq(pluginsTable.name, name));
        }, Effect.orDie),
        setOrder: Effect.fn("PluginRows.setOrder")(function* (order: ReadonlyArray<PluginName>) {
          yield* Effect.forEach(order, (name, index) =>
            db.update(pluginsTable).set({ order: index }).where(eq(pluginsTable.name, name)),
          );
        }, Effect.orDie),
        remove: Effect.fn("PluginRows.remove")(function* (name: PluginName) {
          yield* db.delete(pluginsTable).where(eq(pluginsTable.name, name));
        }, Effect.orDie),
      };
    }),
  );
}
