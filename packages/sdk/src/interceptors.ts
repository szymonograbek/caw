import type { Effect } from "effect";
import { Data } from "effect";
import type { ChannelMessage } from "./channel.ts";
import type { Conversation, Session } from "./conversation.ts";
import type { ToolCallDecision, ToolCallRequest } from "./harness.ts";
import type { Profile } from "./profile.ts";
import type { Tool } from "./tool.ts";

export type InboundDecision = Data.TaggedEnum<{
  Continue: {};
  Transform: { readonly message: ChannelMessage };
  /** Ignore the message silently. */
  Drop: {};
  /** The interceptor took care of the message; core does nothing more. */
  Handled: {};
}>;

export const InboundDecision = Data.taggedEnum<InboundDecision>();

export interface SessionOpeningContext {
  readonly conversation: Conversation;
  /** The top-level Conversation (equals `conversation` outside threads). */
  readonly root: Conversation;
  readonly session: Session;
  readonly profile: Profile;
}

/** What a Plugin adds to a Session when it opens. Fixed for the live Session's lifetime. */
export interface SessionContribution {
  readonly systemPrompt: ReadonlyArray<string>;
  readonly tools: ReadonlyArray<Tool>;
  readonly env: Readonly<Record<string, string>>;
}

export interface TurnInputContext {
  readonly conversation: Conversation;
  readonly session: Session;
}

export interface OutboundReplyContext {
  readonly conversation: Conversation;
  readonly session: Session;
}

export type OutboundDecision = Data.TaggedEnum<{
  Continue: {};
  Transform: { readonly text: string };
  Drop: {};
}>;

export const OutboundDecision = Data.taggedEnum<OutboundDecision>();

/**
 * A Plugin's handlers at core's interception points. Core runs every enabled
 * Plugin's handler for a point in Plugin order and stops at the first
 * `Drop`, `Handled` or `Block`.
 */
export type Interceptor = Data.TaggedEnum<{
  InboundMessage: {
    readonly handle: (
      message: ChannelMessage,
      conversation: Conversation,
    ) => Effect.Effect<InboundDecision>;
  };
  SessionOpening: {
    readonly handle: (context: SessionOpeningContext) => Effect.Effect<SessionContribution>;
  };
  /** Rewrites the formatted input before it reaches the Harness. */
  TurnInput: {
    readonly handle: (input: string, context: TurnInputContext) => Effect.Effect<string>;
  };
  ToolCall: {
    readonly handle: (request: ToolCallRequest) => Effect.Effect<ToolCallDecision>;
  };
  OutboundReply: {
    readonly handle: (
      text: string,
      context: OutboundReplyContext,
    ) => Effect.Effect<OutboundDecision>;
  };
}>;

export const Interceptor = Data.taggedEnum<Interceptor>();
