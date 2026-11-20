import type { Effect, Layer, Option, PubSub, Scope, Stream } from "effect";
import { Context, Schema } from "effect";
import type { SqliteClient } from "@effect/sql-sqlite-bun";
import type { SqlClient, SqlError } from "effect/sql";
import type { Channel } from "./channel.ts";
import type { Conversation } from "./conversation.ts";
import type { CawEvent } from "./events.ts";
import type { Harness } from "./harness.ts";
import type { ConversationId, PluginName, ProfileName } from "./ids.ts";
import type { Interceptor } from "./interceptors.ts";
import type { Profile } from "./profile.ts";
import type { PluginSetup } from "./setup.ts";
import type { Tool } from "./tool.ts";

/** One page of `caw guide <topic>`. Pure data, readable without a running daemon. */
export interface GuidePage {
  readonly topic: string;
  readonly summary: string;
  readonly body: string;
}

/** A numbered, idempotent migration for a Plugin's own `plugin_<name>_*` tables. */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly run: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>;
}

export interface CliContext {
  /** From `CAW_CONVERSATION_ID` when the agent runs the CLI inside a Session. */
  readonly conversationId: Option.Option<ConversationId>;
  /** The invoking shell's working directory; resolve relative paths against it. */
  readonly cwd: string;
}

/** A usage or domain error; the CLI prints `message` and exits non-zero. */
export class CliCommandError extends Schema.TaggedError<
  CliCommandError,
  { readonly brand: unique symbol }
>()("CliCommandError", {
  message: Schema.String,
}) {}

/** `caw <name> ...args`, run inside the daemon. Returns what the CLI prints. */
export interface CliCommand {
  readonly name: string;
  readonly summary: string;
  readonly run: (
    args: ReadonlyArray<string>,
    context: CliContext,
  ) => Effect.Effect<string, CliCommandError>;
}

export type ProfileLookup = (name: ProfileName) => Effect.Effect<Option.Option<Profile>>;

/** A message between Plugins on the inter-plugin bus. */
export interface PluginMessage {
  readonly from: PluginName;
  readonly topic: string;
  readonly payload: unknown;
}

export class ConversationNotFound extends Schema.TaggedError<
  ConversationNotFound,
  { readonly brand: unique symbol }
>()("ConversationNotFound", { conversationId: Schema.String }) {}

/**
 * Core's services for Plugins. Every `register*` lasts for the calling scope:
 * a Plugin's registrations disappear when the Plugin is disabled.
 */
export class Caw extends Context.Service<
  Caw,
  {
    readonly registerChannel: (channel: Channel) => Effect.Effect<void, never, Scope.Scope>;
    readonly registerHarness: (harness: Harness) => Effect.Effect<void, never, Scope.Scope>;
    /** Tools offered to every Session that opens while the Plugin is enabled. */
    readonly registerTool: (tool: Tool) => Effect.Effect<void, never, Scope.Scope>;
    readonly registerInterceptor: (
      interceptor: Interceptor,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly registerCliCommand: (command: CliCommand) => Effect.Effect<void, never, Scope.Scope>;
    readonly registerProfiles: (lookup: ProfileLookup) => Effect.Effect<void, never, Scope.Scope>;
    readonly events: Stream.Stream<CawEvent>;
    readonly bus: PubSub.PubSub<PluginMessage>;
    readonly conversation: (
      id: ConversationId,
    ) => Effect.Effect<Conversation, ConversationNotFound>;
    /** Posts a message to a Conversation outside any Turn. */
    readonly send: (
      conversationId: ConversationId,
      text: string,
    ) => Effect.Effect<void, ConversationNotFound>;
    /**
     * Delivers a scheduled prompt as a `<task>` Turn, following the
     * Conversation's Reply mode (a new thread when `threaded`).
     */
    readonly deliverTask: (
      conversationId: ConversationId,
      prompt: string,
    ) => Effect.Effect<void, ConversationNotFound>;
  }
>()("@gloaming/caw-plugin-sdk/Caw") {}

/** A Plugin's identity and key-value store, provided to its own layer only. */
export class PluginContext extends Context.Service<
  PluginContext,
  {
    readonly name: PluginName;
    readonly get: <A, I>(
      key: string,
      schema: Schema.Codec<A, I>,
    ) => Effect.Effect<Option.Option<A>>;
    readonly set: <A, I>(key: string, schema: Schema.Codec<A, I>, value: A) => Effect.Effect<void>;
  }
>()("@gloaming/caw-plugin-sdk/PluginContext") {}

/** `SqliteClient` is what Drizzle's `effect-sqlite-bun` driver needs for a Plugin's own tables. */
export type PluginServices = Caw | PluginContext | SqlClient.SqlClient | SqliteClient.SqliteClient;

/**
 * What a Plugin package default-exports. The layer's scope is the Plugin's
 * lifetime: disabling the Plugin closes it.
 */
export interface PluginDefinition<Settings> {
  readonly name: PluginName;
  /** Decodes `caw plugin set` values; must decode `{}` to the defaults. */
  readonly settings: Schema.Codec<Settings, unknown>;
  readonly migrations: ReadonlyArray<Migration>;
  readonly guide: ReadonlyArray<GuidePage>;
  /** A directory of agent skills loaded into every Session. */
  readonly skillDir: Option.Option<string>;
  /** The Plugin's part in `caw install`; leave it out for a feature Plugin. */
  readonly setup?: PluginSetup;
  readonly layer: (settings: Settings) => Layer.Layer<never, never, PluginServices>;
}

export const definePlugin = <Settings>(
  definition: PluginDefinition<Settings>,
): PluginDefinition<Settings> => definition;
