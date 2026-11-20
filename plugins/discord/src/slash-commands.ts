import type { Client, Guild } from "discord.js";
import { Events } from "discord.js";
import { Effect, Stream } from "effect";
import type { Scope } from "effect";
import { clientEvents, discordCall } from "./discord-client.ts";

/** The slash commands core understands, as `ChannelCommandName`s. */
const SLASH_COMMANDS = [
  { name: "new", description: "Start a fresh Session in this Conversation" },
  { name: "stop", description: "Interrupt the current Turn" },
];

const registerIn = (guild: Guild) =>
  discordCall("registerCommands", () => guild.commands.set(SLASH_COMMANDS)).pipe(
    Effect.tap(() => Effect.logInfo("Registered Discord slash commands")),
    Effect.catch((error) => Effect.logWarning("Registering Discord slash commands failed", error)),
    Effect.annotateLogs({ guildId: guild.id }),
  );

/**
 * Registers `/new` and `/stop` as guild commands, which appear at once (global
 * commands can take an hour), in every current guild and in each guild joined later.
 */
export const registerSlashCommands = (
  client: Client<true>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* clientEvents(client, Events.GuildCreate).pipe(
      Stream.runForEach(([guild]) => registerIn(guild)),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* Effect.forEach(client.guilds.cache.values(), registerIn, {
      concurrency: "unbounded",
      discard: true,
    });
  });
