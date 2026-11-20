import type { ChatInputCommandInteraction, Client, Message, TextBasedChannel } from "discord.js";
import { Events } from "discord.js";
import { Context, Effect, Filter, Layer, Option, Schedule, Stream } from "effect";
import type { Channel, ChannelError, ChannelMessage } from "@gloaming/caw-plugin-sdk/channel";
import { ChannelInput } from "@gloaming/caw-plugin-sdk/channel";
import type { ChannelMessageId, ExternalConversationId } from "@gloaming/caw-plugin-sdk/ids";
import {
  ChannelMessageId as MessageId,
  ExternalConversationId as ConversationId,
} from "@gloaming/caw-plugin-sdk/ids";
import { chunkMessage, DISCORD_MESSAGE_LIMIT } from "./chunk-message.ts";
import { adoptDefaultAvatar } from "./default-avatar.ts";
import type { MessageNotFound } from "./discord-client.ts";
import {
  channelError,
  clientEvents,
  connectClient,
  discordCall,
  messageCall,
} from "./discord-client.ts";
import type { DiscordMessage, DiscordPlace } from "./inbound.ts";
import { DISCORD_CHANNEL, isFromPerson, parseCommand, parseMessage } from "./inbound.ts";
import { registerSlashCommands } from "./slash-commands.ts";
import { threadName } from "./thread-name.ts";

/** Discord shows typing for ~10s per call, so it is refreshed a little sooner. */
const TYPING_REFRESH = "8 seconds";

/** The most messages one history request returns. */
const HISTORY_PAGE = 100;

const placeOf = (channel: TextBasedChannel): DiscordPlace => {
  if (channel.isThread()) {
    return { kind: "thread", parentId: channel.parentId };
  }

  return channel.isDMBased() ? { kind: "direct" } : { kind: "guild" };
};

const authorOf = (message: Message) => ({
  id: message.author.id,
  name: message.member?.displayName ?? message.author.displayName,
  bot: message.author.bot,
});

/** discord.js caches the referenced message it receives with a reply. */
const referencedOf = (message: Message) =>
  Option.fromNullishOr(message.reference?.messageId).pipe(
    Option.flatMap((id) => Option.fromNullishOr(message.channel.messages.cache.get(id))),
    Option.map((quoted) => ({ id: quoted.id, author: authorOf(quoted), content: quoted.content })),
    Option.getOrNull,
  );

const toDiscordMessage = (message: Message): DiscordMessage => ({
  id: message.id,
  channelId: message.channelId,
  place: placeOf(message.channel),
  author: authorOf(message),
  system: message.system,
  content: message.content,
  createdTimestamp: message.createdTimestamp,
  referenced: referencedOf(message),
  attachments: message.attachments.map((attachment) => ({
    name: attachment.name,
    url: attachment.url,
    contentType: attachment.contentType,
  })),
});

const commandInput = (interaction: ChatInputCommandInteraction): Option.Option<ChannelInput> =>
  Option.fromNullishOr(interaction.channel).pipe(
    Option.flatMap((channel) =>
      parseCommand(
        { commandName: interaction.commandName, channelId: channel.id, place: placeOf(channel) },
        (text) =>
          discordCall("respond", () => interaction.reply({ content: text })).pipe(
            Effect.andThen(Effect.void),
          ),
      ),
    ),
  );

interface DiscordChannelApi {
  readonly channel: Channel;
  readonly react: (
    conversation: ExternalConversationId,
    message: ChannelMessageId,
    emoji: string,
  ) => Effect.Effect<void, ChannelError | MessageNotFound>;
}

const buildChannel = (client: Client<true>): DiscordChannelApi => {
  const sendable = Effect.fn("DiscordChannel.sendable")(function* (
    conversation: ExternalConversationId,
  ) {
    const channel = yield* discordCall("fetchChannel", () => client.channels.fetch(conversation));

    if (channel !== null && channel.isSendable()) {
      return channel;
    }

    return yield* channelError("fetchChannel", `${conversation} is not a text channel`);
  });

  const fetchMessage = Effect.fn("DiscordChannel.fetchMessage")(function* (
    conversation: ExternalConversationId,
    message: ChannelMessageId,
  ) {
    const channel = yield* sendable(conversation);

    return yield* messageCall("fetchMessage", message, () => channel.messages.fetch(message));
  });

  const react = Effect.fn("DiscordChannel.react")(function* (
    conversation: ExternalConversationId,
    message: ChannelMessageId,
    emoji: string,
  ) {
    const target = yield* fetchMessage(conversation, message);

    yield* messageCall("react", message, () => target.react(emoji));
  });

  const send = Effect.fn("DiscordChannel.send")(function* (
    conversation: ExternalConversationId,
    text: string,
  ) {
    const channel = yield* sendable(conversation);

    return yield* Effect.forEach(chunkMessage(text, DISCORD_MESSAGE_LIMIT), (content) =>
      discordCall<Message>("send", () =>
        // Agent text never pings @everyone or @here.
        channel.send({ content, allowedMentions: { parse: ["users", "roles"] } }),
      ).pipe(Effect.map((sent) => MessageId.make(sent.id))),
    );
  });

  const openThread = Effect.fn("DiscordChannel.openThread")(function* (
    conversation: ExternalConversationId,
    from: ChannelMessageId,
    name: string,
  ) {
    const message = yield* fetchMessage(conversation, from).pipe(
      Effect.catchTag("MessageNotFound", (cause) => Effect.fail(channelError("openThread", cause))),
    );

    const thread = yield* discordCall("openThread", () =>
      message.startThread({ name: threadName(name) }),
    );

    return ConversationId.make(thread.id);
  });

  const history = Effect.fn("DiscordChannel.history")(function* (
    conversation: ExternalConversationId,
    limit: number,
  ) {
    const channel = yield* sendable(conversation);
    const newestFirst: Array<Message> = [];
    let before = Option.none<string>();
    let exhausted = false;

    while (!exhausted && newestFirst.length < limit) {
      const size = Math.min(HISTORY_PAGE, limit - newestFirst.length);

      const options = Option.match(before, {
        onNone: () => ({ limit: size }),
        onSome: (id) => ({ limit: size, before: id }),
      });

      const page = [
        ...(yield* discordCall("history", () => channel.messages.fetch(options))).values(),
      ];

      newestFirst.push(...page);
      before = Option.fromNullishOr(page.at(-1)?.id);
      exhausted = page.length < size;
    }

    return newestFirst
      .toReversed()
      .flatMap((message): ReadonlyArray<ChannelMessage> =>
        message.system ? [] : Option.toArray(parseMessage(toDiscordMessage(message))),
      );
  });

  const typing = (conversation: ExternalConversationId) =>
    sendable(conversation).pipe(
      Effect.flatMap((channel) => discordCall("typing", () => channel.sendTyping())),
      Effect.catch((error) => Effect.logWarning("Discord typing indicator failed", error)),
      Effect.repeat(Schedule.spaced(TYPING_REFRESH)),
      Effect.forkScoped,
      Effect.andThen(Effect.void),
    );

  const messages = clientEvents(client, Events.MessageCreate).pipe(
    Stream.map(([message]) => toDiscordMessage(message)),
    Stream.filter(isFromPerson),
    Stream.filterMap(Filter.fromPredicateOption(parseMessage)),
    Stream.map((message) => ChannelInput.Message({ message })),
  );

  const commands = clientEvents(client, Events.InteractionCreate).pipe(
    Stream.filterMap(
      Filter.fromPredicateOption(([interaction]) =>
        interaction.isChatInputCommand() ? commandInput(interaction) : Option.none(),
      ),
    ),
  );

  return {
    react,
    channel: {
      name: DISCORD_CHANNEL,
      markup: "Discord markdown",
      inputs: Stream.merge(messages, commands),
      send,
      openThread,
      react: (conversation, message, emoji) =>
        react(conversation, message, emoji).pipe(
          Effect.catchTag("MessageNotFound", (cause) => Effect.fail(channelError("react", cause))),
        ),
      typing,
      history,
    },
  };
};

/**
 * The Discord Channel on a connected client with `/new` and `/stop` registered
 * and Caw's avatar on a bot that has none,
 * plus a `react` that tells a missing message apart, for the react tool. The
 * gateway connection lasts as long as the layer.
 */
export class DiscordChannel extends Context.Service<DiscordChannel, DiscordChannelApi>()(
  "@caw/plugin-discord/DiscordChannel",
) {
  static readonly layer = Layer.effect(
    DiscordChannel,
    Effect.gen(function* () {
      const client = yield* connectClient;

      yield* registerSlashCommands(client);
      yield* adoptDefaultAvatar(client.user);

      return buildChannel(client);
    }),
  );
}
