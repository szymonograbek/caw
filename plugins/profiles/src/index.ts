import { Effect, Layer, Option, Schema } from "effect";
import { PluginName } from "@gloaming/caw-plugin-sdk/ids";
import { definePlugin, Caw } from "@gloaming/caw-plugin-sdk/plugin";
import { profilesGuide } from "./guide.ts";
import { profileCommand } from "./profile-command.ts";
import { ProfileStore } from "./profile-store.ts";
import { profilesMigrations } from "./profiles-table.ts";

const pluginLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const caw = yield* Caw;
    const store = yield* ProfileStore;

    const command = yield* profileCommand;

    yield* caw.registerProfiles(store.find);
    yield* caw.registerCliCommand(command);
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
