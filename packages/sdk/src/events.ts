import { Data } from "effect";
import type { ChannelMessage } from "./channel.ts";
import type { Conversation, Session } from "./conversation.ts";
import type { HarnessEvent, SessionStart } from "./harness.ts";
import type { ChannelMessageId, ConversationId, PluginName, SessionId } from "./ids.ts";

export type SessionCloseReason =
  | "idle"
  | "evicted"
  | "reset"
  | "profile-changed"
  | "plugins-changed"
  | "shutdown";

export type TurnOutcome = "completed" | "interrupted" | "failed";

/** Everything core announces. Plugins observe these; they cannot change them. */
export type OmenEvent = Data.TaggedEnum<{
  DaemonStarted: {};
  DaemonStopping: {};
  MessageReceived: { readonly conversation: Conversation; readonly message: ChannelMessage };
  ConversationCreated: { readonly conversation: Conversation };
  SessionOpened: { readonly session: Session; readonly start: SessionStart };
  SessionClosed: { readonly sessionId: SessionId; readonly reason: SessionCloseReason };
  SessionLost: { readonly sessionId: SessionId; readonly replacement: SessionId };
  TurnStarted: { readonly sessionId: SessionId };
  TurnEnded: { readonly sessionId: SessionId; readonly outcome: TurnOutcome };
  HarnessEventReceived: { readonly sessionId: SessionId; readonly event: HarnessEvent };
  ReplySent: {
    readonly conversationId: ConversationId;
    readonly messageIds: ReadonlyArray<ChannelMessageId>;
    readonly text: string;
  };
  PluginEnabled: { readonly plugin: PluginName };
  PluginDisabled: { readonly plugin: PluginName };
}>;

export const OmenEvent = Data.taggedEnum<OmenEvent>();
