import { Schema } from "effect";
import {
  ChannelName,
  ConversationId,
  ExternalConversationId,
  HarnessName,
  ProfileName,
  SessionId,
} from "./ids.ts";

/**
 * `threaded`: each top-level message opens a thread with its own Session.
 * `inline`: the Conversation is one Session; a thread a person opens Forks it.
 */
export const ReplyMode = Schema.Literals(["threaded", "inline"]);

export type ReplyMode = typeof ReplyMode.Type;

export class Conversation extends Schema.Class<Conversation, { readonly brand: unique symbol }>(
  "Conversation",
)({
  id: ConversationId,
  channel: ChannelName,
  externalId: ExternalConversationId,
  /** Set for threads. Workspace, profile and Memory come from the top-level parent. */
  parentId: Schema.Option(ConversationId),
  replyMode: ReplyMode,
  profile: Schema.Option(ProfileName),
}) {}

export const SessionStatus = Schema.Literals(["live", "idle", "lost", "closed"]);

export type SessionStatus = typeof SessionStatus.Type;

export class Session extends Schema.Class<Session, { readonly brand: unique symbol }>("Session")({
  id: SessionId,
  conversationId: ConversationId,
  harness: HarnessName,
  profile: ProfileName,
  status: SessionStatus,
  forkedFrom: Schema.Option(SessionId),
}) {}
