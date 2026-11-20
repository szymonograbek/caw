import type { DateTime, Effect, Option, Scope, Stream } from "effect";
import { Data, Schema } from "effect";
import type { ChannelMessageId, ChannelName, ExternalConversationId } from "./ids.ts";

/** Where a Conversation sits on its platform. A thread is a child Conversation of `parent`. */
export type ConversationPlace = Data.TaggedEnum<{
  Room: {};
  Thread: { readonly parent: ExternalConversationId };
  Direct: {};
}>;

export const ConversationPlace = Data.taggedEnum<ConversationPlace>();

export interface Author {
  readonly id: string;
  readonly name: string;
}

export interface QuotedMessage {
  readonly messageId: ChannelMessageId;
  readonly author: Author;
  readonly text: string;
}

export interface Attachment {
  readonly name: string;
  readonly url: string;
  readonly contentType: Option.Option<string>;
}

/** One message as a Channel parsed it from its platform. */
export interface ChannelMessage {
  readonly channel: ChannelName;
  readonly conversation: ExternalConversationId;
  readonly place: ConversationPlace;
  readonly messageId: ChannelMessageId;
  readonly author: Author;
  readonly text: string;
  readonly sentAt: DateTime.Utc;
  readonly replyTo: Option.Option<QuotedMessage>;
  readonly attachments: ReadonlyArray<Attachment>;
}

export type ChannelCommandName = "new" | "stop";

/** What a Channel delivers to core: a person's message, or a control command (`/new`, `/stop`). */
export type ChannelInput = Data.TaggedEnum<{
  Message: { readonly message: ChannelMessage };
  Command: {
    readonly channel: ChannelName;
    readonly conversation: ExternalConversationId;
    readonly place: ConversationPlace;
    readonly command: ChannelCommandName;
    /** Answers the command on the platform (e.g. a Discord interaction reply). Call exactly once. */
    readonly respond: (text: string) => Effect.Effect<void, ChannelError>;
  };
}>;

export const ChannelInput = Data.taggedEnum<ChannelInput>();

export class ChannelError extends Schema.TaggedError<
  ChannelError,
  { readonly brand: unique symbol }
>()("ChannelError", {
  channel: Schema.String,
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * An integration with a chat platform. Implementations own platform limits
 * (message length chunking, typing refresh intervals) so core never sees them.
 */
export interface Channel {
  readonly name: ChannelName;
  /** Text for the system prompt naming the markup this platform renders, e.g. "Discord markdown". */
  readonly markup: string;
  readonly inputs: Stream.Stream<ChannelInput, ChannelError>;
  /** Posts `text`, split into as many platform messages as needed, in order. */
  readonly send: (
    conversation: ExternalConversationId,
    text: string,
  ) => Effect.Effect<ReadonlyArray<ChannelMessageId>, ChannelError>;
  /** Opens a thread from an existing message and returns the thread's id. */
  readonly openThread: (
    conversation: ExternalConversationId,
    from: ChannelMessageId,
    name: string,
  ) => Effect.Effect<ExternalConversationId, ChannelError>;
  readonly react: (
    conversation: ExternalConversationId,
    message: ChannelMessageId,
    emoji: string,
  ) => Effect.Effect<void, ChannelError>;
  /** Shows a typing indicator for as long as the surrounding scope stays open. */
  readonly typing: (
    conversation: ExternalConversationId,
  ) => Effect.Effect<void, never, Scope.Scope>;
  /** The most recent `limit` messages of a Conversation, oldest first. */
  readonly history: (
    conversation: ExternalConversationId,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<ChannelMessage>, ChannelError>;
}
