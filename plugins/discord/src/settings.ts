import { Effect, Schema } from "effect";

/** The emoji the agent may react with unless settings say otherwise. */
const DEFAULT_REACTIONS = ["👀", "✅", "👍", "❤️", "😂", "🤔", "🎉", "⚠️"];

export const DiscordSettings = Schema.Struct({
  /** The only emoji the `react` tool accepts. */
  allowedReactions: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_REACTIONS)),
  ),
});

export type DiscordSettings = typeof DiscordSettings.Type;
