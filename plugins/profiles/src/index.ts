import { Effect, Layer, Option, Schema } from "effect";
import { PluginName } from "@omen/sdk/ids";
import { definePlugin, Omen } from "@omen/sdk/plugin";
import { profilesGuide } from "./guide.ts";
import { profileCommand } from "./profile-command.ts";
import { ProfileStore } from "./profile-store.ts";
import { profilesMigrations } from "./profiles-table.ts";

const pluginLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const omen = yield* Omen;
    const store = yield* ProfileStore;

    const command = yield* profileCommand;

    yield* omen.registerProfiles(store.find);
    yield* omen.registerCliCommand(command);
  }),
).pipe(Layer.provide(ProfileStore.layer));

export default definePlugin({
  name: PluginName.make("profiles"),
  settings: Schema.Struct({}),
  migrations: profilesMigrations,
  guide: [profilesGuide],
  skillDir: Option.none(),
  layer: () => pluginLayer,
});
