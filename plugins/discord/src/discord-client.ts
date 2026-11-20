import type { ClientEvents } from "discord.js";
import { Client, DiscordAPIError, Events, GatewayIntentBits, Partials } from "discord.js";
import { Config, Effect, Queue, Redacted, Schema, Stream } from "effect";
import type { Scope } from "effect";
import { ChannelError } from "@caw/sdk/channel";
import { DISCORD_CHANNEL } from "./inbound.ts";

/** Discord answered that the message does not exist in that channel. */
export class MessageNotFound extends Schema.TaggedError<
  MessageNotFound,
  { readonly brand: unique symbol }
>()("MessageNotFound", {
  messageId: Schema.String,
}) {}

/** Discord's JSON error code for "Unknown Message". */
const UNKNOWN_MESSAGE = 10008;

/** A `ChannelError` from this Channel. */
export const channelError = (operation: string, cause: unknown): ChannelError =>
  new ChannelError({ channel: DISCORD_CHANNEL, operation, cause });

/** Runs one discord.js call, failing with a `ChannelError` naming `operation`. */
export const discordCall = <A>(
  operation: string,
  call: () => Promise<A>,
): Effect.Effect<A, ChannelError> =>
  Effect.tryPromise({ try: call, catch: (cause) => channelError(operation, cause) });

/** Like `discordCall`, but Discord's "Unknown Message" becomes `MessageNotFound`. */
export const messageCall = <A>(
  operation: string,
  messageId: string,
  call: () => Promise<A>,
): Effect.Effect<A, ChannelError | MessageNotFound> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof DiscordAPIError && cause.code === UNKNOWN_MESSAGE
        ? new MessageNotFound({ messageId })
        : channelError(operation, cause),
  });

/** Every emission of a client event while the stream runs. */
export const clientEvents = <Event extends keyof ClientEvents>(
  client: Client,
  event: Event,
): Stream.Stream<ClientEvents[Event]> =>
  Stream.callback<ClientEvents[Event]>((queue) => {
    const listener = (...args: ClientEvents[Event]) => {
      Queue.offerUnsafe(queue, args);
    };

    return Effect.acquireRelease(
      Effect.sync(() => client.on(event, listener)),
      () => Effect.sync(() => client.off(event, listener)),
    );
  });

/** Logs in and waits until the gateway reports the client ready. */
const login = (
  client: Client,
  token: Redacted.Redacted,
): Effect.Effect<Client<true>, ChannelError> =>
  Effect.callback<Client<true>, ChannelError>((resume) => {
    client.once(Events.ClientReady, (ready) => resume(Effect.succeed(ready)));
    client.login(Redacted.value(token)).catch((cause: unknown) => {
      resume(Effect.fail(channelError("login", cause)));
    });
  });

/**
 * A logged-in, ready client reading `DISCORD_TOKEN`. It is destroyed, closing its
 * gateway connection, when the scope closes.
 */
export const connectClient: Effect.Effect<
  Client<true>,
  ChannelError | Config.ConfigError,
  Scope.Scope
> = Effect.gen(function* () {
  const token = yield* Config.Redacted("DISCORD_TOKEN");

  const client = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
          ],
          // DM channels are not cached until their first message arrives.
          partials: [Partials.Channel],
        }),
    ),
    (created) => Effect.promise(() => created.destroy()),
  );

  yield* clientEvents(client, Events.Error).pipe(
    Stream.runForEach(([error]) => Effect.logError("Discord client error", error)),
    Effect.forkScoped({ startImmediately: true }),
  );

  return yield* login(client, token);
});
