import { Effect, Layer, Option } from "effect";
import { definePlugin, Omen } from "@omen/sdk/plugin";
import { PluginName } from "@omen/sdk/ids";
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
        const omen = yield* Omen;
        const discord = yield* DiscordChannel;

        yield* omen.registerChannel(discord.channel);
        yield* omen.registerTool(
          reactTool({
            allowedReactions: settings.allowedReactions,
            conversation: omen.conversation,
            react: discord.react,
          }),
        );
      }),
    ).pipe(
      // Without a working token and gateway connection the Plugin can do nothing.
      Layer.provide(Layer.orDie(DiscordChannel.layer)),
    ),
});
