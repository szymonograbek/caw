import { answer, PluginSetup, SetupError, SetupQuestion } from "@gloaming/sdk/setup";
import { Effect, Match, Schema } from "effect";
import type { HttpClientError } from "effect/http";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const api = "https://discord.com/api/v10";

/**
 * What Caw does in a server: read and answer messages, open and answer in
 * threads, react, read history for lost-Session recovery, and slash commands.
 */
const permissions = [
  1n << 6n, // Add Reactions
  1n << 10n, // View Channels
  1n << 11n, // Send Messages
  1n << 16n, // Read Message History
  1n << 31n, // Use Application Commands
  1n << 35n, // Create Public Threads
  1n << 38n, // Send Messages in Threads
].reduce((all, bit) => all | bit, 0n);

const BotUser = Schema.Struct({ id: Schema.String, username: Schema.String });
const Guilds = Schema.Array(Schema.Struct({ name: Schema.String }));

const Application = Schema.Struct({
  id: Schema.String,
  flags: Schema.optionalKey(Schema.Finite),
});

/** `GATEWAY_MESSAGE_CONTENT` or its `_LIMITED` variant: without one, message text arrives empty. */
const messageContentIntent = (1 << 19) | (1 << 18);

/** The URL that adds the bot to a server with the permissions Caw needs. */
const inviteUrl = (applicationId: string): string =>
  `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${permissions}`;

const toSetupError = (error: SetupError | HttpClientError.HttpClientError | Schema.SchemaError) =>
  Match.valueTags(error, {
    SetupError: (rejected) => rejected,
    HttpClientError: ({ message }) =>
      new SetupError({ message: `Could not reach Discord: ${message}` }),
    SchemaError: ({ message }) =>
      new SetupError({ message: `Discord answered unexpectedly: ${message}` }),
  });

/** Checks the token against Discord's REST API, reporting the bot and its servers. */
const configure = Effect.fn("DiscordSetup.configure")(function* (token: string) {
  const client = yield* HttpClient.HttpClient;

  const get = (path: string) =>
    client
      .execute(
        HttpClientRequest.get(`${api}${path}`).pipe(
          HttpClientRequest.setHeader("Authorization", `Bot ${token}`),
        ),
      )
      .pipe(
        Effect.flatMap(
          (
            response,
          ): Effect.Effect<
            HttpClientResponse.HttpClientResponse,
            SetupError | HttpClientError.HttpClientError
          > =>
            response.status === 401
              ? Effect.fail(new SetupError({ message: "Discord rejected the bot token." }))
              : HttpClientResponse.filterStatusOk(response),
        ),
      );

  const fetchBot = get("/users/@me").pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(BotUser)),
    Effect.mapError(toSetupError),
  );

  const fetchGuilds = get("/users/@me/guilds").pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Guilds)),
    Effect.mapError(toSetupError),
  );

  const fetchApplication = get("/applications/@me").pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Application)),
    Effect.mapError(toSetupError),
  );

  const bot = yield* fetchBot;
  const guilds = yield* fetchGuilds;
  const application = yield* fetchApplication;

  const servers =
    guilds.length === 0
      ? ["The bot is in no server yet. Add it with:", `  ${inviteUrl(application.id)}`]
      : [`Servers: ${guilds.map((guild) => guild.name).join(", ")}`];

  return {
    report: [
      `Bot: ${bot.username}`,
      ...servers,
      ...(((application.flags ?? 0) & messageContentIntent) === 0
        ? ["Turn on the Message Content intent for the bot in the Discord developer portal."]
        : []),
    ],
    env: { DISCORD_TOKEN: token },
  };
});

export const discordSetup: PluginSetup = PluginSetup.Channel({
  title: "Discord",
  hint: "Discord bot",
  questions: [
    SetupQuestion.Secret({
      key: "token",
      flag: "discord-token",
      message: "Discord bot token",
    }),
  ],
  configure: (answers) =>
    Effect.flatMap(answer(answers, "token"), (token) => configure(token.trim())),
});
