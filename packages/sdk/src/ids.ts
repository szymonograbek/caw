import { Schema } from "effect";

/** Caw's own id for a Conversation (a Discord channel, thread or DM). */
export const ConversationId = Schema.String.pipe(Schema.brand("ConversationId"));

export type ConversationId = typeof ConversationId.Type;

/** Caw's own id for a Session. Exposed to the agent as `CAW_SESSION_ID`. */
export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));

export type SessionId = typeof SessionId.Type;

/** The registered name of a Channel, e.g. `discord`. */
export const ChannelName = Schema.String.pipe(Schema.brand("ChannelName"));

export type ChannelName = typeof ChannelName.Type;

/** The chat platform's id for a Conversation (a Discord channel or thread snowflake). */
export const ExternalConversationId = Schema.String.pipe(Schema.brand("ExternalConversationId"));

export type ExternalConversationId = typeof ExternalConversationId.Type;

/** The chat platform's id for one message. */
export const ChannelMessageId = Schema.String.pipe(Schema.brand("ChannelMessageId"));

export type ChannelMessageId = typeof ChannelMessageId.Type;

/** The registered name of a Harness, e.g. `claude`. */
export const HarnessName = Schema.String.pipe(Schema.brand("HarnessName"));

export type HarnessName = typeof HarnessName.Type;

/** A Plugin's name; also the suffix of its tables (`plugin_<name>_*`) and MCP server (`caw_<name>`). */
export const PluginName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/)).pipe(
  Schema.brand("PluginName"),
);

export type PluginName = typeof PluginName.Type;

/** A Harness profile's name. `default` applies when a Conversation sets none. */
export const ProfileName = Schema.String.pipe(Schema.brand("ProfileName"));

export type ProfileName = typeof ProfileName.Type;
