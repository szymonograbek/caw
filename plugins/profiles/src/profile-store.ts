import { asc, eq } from "drizzle-orm";
import * as SqliteDrizzle from "drizzle-orm/effect-sqlite-bun";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HarnessName, ProfileName } from "@gloaming/sdk/ids";
import { Profile } from "@gloaming/sdk/profile";
import { profilesTable } from "./profiles-table.ts";

/** A `plugin_profiles_profiles` row, decoded into a Profile's fields. */
const ProfileRow = Schema.Struct({
  name: ProfileName,
  harness: HarnessName,
  env: Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
  model: Schema.OptionFromNullOr(Schema.String),
  effort: Schema.OptionFromNullOr(Schema.String),
  cwd: Schema.OptionFromNullOr(Schema.String),
  settingSources: Schema.OptionFromNullOr(Schema.fromJsonString(Schema.Array(Schema.String))),
});

const decodeRow = (row: typeof profilesTable.$inferSelect) =>
  Schema.decodeEffect(ProfileRow)(row).pipe(Effect.map((fields) => new Profile(fields)));

/** The Harness profiles users stored with `caw profile add`. */
export class ProfileStore extends Context.Service<
  ProfileStore,
  {
    /** Creates the profile, or replaces the one with the same name. */
    readonly save: (profile: Profile) => Effect.Effect<void>;
    readonly find: (name: ProfileName) => Effect.Effect<Option.Option<Profile>>;
    /** All profiles, by name. */
    readonly list: Effect.Effect<ReadonlyArray<Profile>>;
    /** Whether a profile with that name existed. */
    readonly remove: (name: ProfileName) => Effect.Effect<boolean>;
  }
>()("@gloaming/plugin-profiles/ProfileStore") {
  static readonly layer = Layer.effect(
    ProfileStore,
    Effect.gen(function* () {
      const db = yield* SqliteDrizzle.makeWithDefaults();

      const save = Effect.fn("ProfileStore.save")(function* (profile: Profile) {
        const { name, ...fields } = yield* Schema.encodeEffect(ProfileRow)(profile);

        yield* db
          .insert(profilesTable)
          .values({ name, ...fields })
          .onConflictDoUpdate({ target: profilesTable.name, set: fields });
      }, Effect.orDie);

      const find = Effect.fn("ProfileStore.find")(function* (name: ProfileName) {
        const rows = yield* db.select().from(profilesTable).where(eq(profilesTable.name, name));

        return yield* Effect.transposeOption(Option.map(Option.fromIterable(rows), decodeRow));
      }, Effect.orDie);

      const list = db
        .select()
        .from(profilesTable)
        .orderBy(asc(profilesTable.name))
        .pipe(Effect.flatMap(Effect.forEach(decodeRow)), Effect.orDie);

      const remove = Effect.fn("ProfileStore.remove")(function* (name: ProfileName) {
        const removed = yield* db
          .delete(profilesTable)
          .where(eq(profilesTable.name, name))
          .returning({ name: profilesTable.name });

        return removed.length > 0;
      }, Effect.orDie);

      return { save, find, list, remove };
    }),
  );
}
