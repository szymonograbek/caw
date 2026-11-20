import { Effect, Layer, Option } from "effect";
import { definePlugin, Caw } from "@caw/sdk/plugin";
import { PluginName } from "@caw/sdk/ids";
import { DiscordChannel } from "./discord-channel.ts";
import { discordGuide } from "./guide.ts";
import { reactTool } from "./react-tool.ts";
import { DiscordSettings } from "./settings.ts";
import { discordSetup } from "./setup.ts";

export default definePlugin({
  name: PluginName.make("discord"),
  settings: DiscordSettings,
  migrations: [],
  guide: [discordGuide],
  skillDir: Option.none(),
  setup: discordSetup,
  layer: (settings) =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const caw = yield* Caw;
        const discord = yield* DiscordChannel;

        yield* caw.registerChannel(discord.channel);
        yield* caw.registerTool(
          reactTool({
            allowedReactions: settings.allowedReactions,
            conversation: caw.conversation,
            react: discord.react,
          }),
        );
      }),
    ).pipe(
      // Without a working token and gateway connection the Plugin can do nothing.
      Layer.provide(Layer.orDie(DiscordChannel.layer)),
    ),
});
