import { DateTime, Option, Schema } from "effect";
import type { Effect } from "effect";
import type {
  Author,
  ChannelCommandName,
  ChannelError,
  ChannelMessage,
  QuotedMessage,
} from "@omen/sdk/channel";
import { ChannelInput, ConversationPlace } from "@omen/sdk/channel";
import { ChannelMessageId, ChannelName, ExternalConversationId } from "@omen/sdk/ids";

/** The registered name of this Channel. */
export const DISCORD_CHANNEL = ChannelName.make("discord");

/** Where a Discord message or interaction happened, as discord.js reports it. */
export type DiscordPlace =
  | { readonly kind: "guild" }
  | { readonly kind: "thread"; readonly parentId: string | null }
  | { readonly kind: "direct" };

interface DiscordAuthor {
  readonly id: string;
  readonly name: string;
  readonly bot: boolean;
}

export interface DiscordQuoted {
  readonly id: string;
  readonly author: DiscordAuthor;
  readonly content: string;
}

interface DiscordAttachment {
  readonly name: string;
  readonly url: string;
  readonly contentType: string | null;
}

/** The plain fields of a discord.js `Message` that Omen reads. */
export interface DiscordMessage {
  readonly id: string;
  readonly channelId: string;
  readonly place: DiscordPlace;
  readonly author: DiscordAuthor;
  readonly system: boolean;
  readonly content: string;
  readonly createdTimestamp: number;
  readonly referenced: DiscordQuoted | null;
  readonly attachments: ReadonlyArray<DiscordAttachment>;
}

/** The plain fields of a discord.js slash-command interaction that Omen reads. */
export interface DiscordCommand {
  readonly commandName: string;
  readonly channelId: string;
  readonly place: DiscordPlace;
}

const CommandName = Schema.Literals(["new", "stop"] satisfies ReadonlyArray<ChannelCommandName>);

const toPlace = (place: DiscordPlace): Option.Option<ConversationPlace> => {
  if (place.kind === "guild") {
    return Option.some(ConversationPlace.Room());
  }

  if (place.kind === "direct") {
    return Option.some(ConversationPlace.Direct());
  }

  return Option.fromNullishOr(place.parentId).pipe(
    Option.map((parent) =>
      ConversationPlace.Thread({ parent: ExternalConversationId.make(parent) }),
    ),
  );
};

const toAuthor = (author: DiscordAuthor): Author => ({ id: author.id, name: author.name });

const toQuoted = (quoted: DiscordQuoted): QuotedMessage => ({
  messageId: ChannelMessageId.make(quoted.id),
  author: toAuthor(quoted.author),
  text: quoted.content,
});

/** A message a person wrote: not from a bot (Omen included) and not a system notice. */
export const isFromPerson = (message: DiscordMessage): boolean =>
  !message.author.bot && !message.system;

/** `None` when the message sits somewhere Omen cannot place (a thread without a parent). */
export const parseMessage = (message: DiscordMessage): Option.Option<ChannelMessage> =>
  toPlace(message.place).pipe(
    Option.map((place) => ({
      channel: DISCORD_CHANNEL,
      conversation: ExternalConversationId.make(message.channelId),
      place,
      messageId: ChannelMessageId.make(message.id),
      author: toAuthor(message.author),
      text: message.content,
      sentAt: DateTime.makeUnsafe(message.createdTimestamp),
      replyTo: Option.fromNullishOr(message.referenced).pipe(Option.map(toQuoted)),
      attachments: message.attachments.map((attachment) => ({
        name: attachment.name,
        url: attachment.url,
        contentType: Option.fromNullishOr(attachment.contentType),
      })),
    })),
  );

/** `None` for a command Omen does not define or a place it cannot resolve. */
export const parseCommand = (
  command: DiscordCommand,
  respond: (text: string) => Effect.Effect<void, ChannelError>,
): Option.Option<ChannelInput> =>
  Option.all({
    name: Schema.decodeUnknownOption(CommandName)(command.commandName),
    place: toPlace(command.place),
  }).pipe(
    Option.map(({ name, place }) =>
      ChannelInput.Command({
        channel: DISCORD_CHANNEL,
        conversation: ExternalConversationId.make(command.channelId),
        place,
        command: name,
        respond,
      }),
    ),
  );
