import type { Effect, Scope, Stream } from "effect";
import { Data, Schema } from "effect";
import type { ConversationId, HarnessName, SessionId } from "./ids.ts";
import type { Profile } from "./profile.ts";
import type { ToolGroup } from "./tool.ts";

/**
 * A Harness's opaque resume token, stored as `resume_cursor_json`. Each
 * Harness decodes it with its own Schema at its boundary.
 */
export const ResumeCursor = Schema.Json;

export type ResumeCursor = typeof ResumeCursor.Type;

export type SessionStart = Data.TaggedEnum<{
  New: {};
  Resume: { readonly cursor: ResumeCursor };
  /** Starts a new Session from a copy of the history behind `cursor`. */
  Fork: { readonly cursor: ResumeCursor };
}>;

export const SessionStart = Data.taggedEnum<SessionStart>();

export class HarnessError extends Schema.TaggedError<
  HarnessError,
  { readonly brand: unique symbol }
>()("HarnessError", {
  harness: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** The Harness no longer knows the Session behind a cursor; core recovers it as `lost`. */
export class SessionNotFound extends Schema.TaggedError<
  SessionNotFound,
  { readonly brand: unique symbol }
>()("SessionNotFound", {
  harness: Schema.String,
}) {}

export type HarnessEvent = Data.TaggedEnum<{
  /** One finished assistant text block. */
  Text: { readonly text: string };
  ToolCall: { readonly id: string; readonly name: string; readonly input: Schema.Json };
  ToolResult: { readonly id: string; readonly output: string; readonly isError: boolean };
  /** The Turn stopped and the Harness waits for more input. */
  TurnEnded: {};
  /** The Turn failed; the Session stays usable unless the stream ends. */
  Failed: { readonly error: HarnessError | SessionNotFound };
  CursorUpdated: { readonly cursor: ResumeCursor };
}>;

export const HarnessEvent = Data.taggedEnum<HarnessEvent>();

/** What a ToolCall interceptor decided. */
export type ToolCallDecision = Data.TaggedEnum<{
  Allow: {};
  Block: { readonly reason: string };
  Mutate: { readonly input: Schema.Json };
}>;

export const ToolCallDecision = Data.taggedEnum<ToolCallDecision>();

export interface ToolCallRequest {
  readonly sessionId: SessionId;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface OpenSession {
  readonly start: SessionStart;
  readonly conversationId: ConversationId;
  /** The top-level Conversation that owns Workspace, profile and Memory (equals `conversationId` outside threads). */
  readonly rootConversationId: ConversationId;
  readonly sessionId: SessionId;
  readonly profile: Profile;
  readonly cwd: string;
  /** Merged env: process env, profile env, plugin env, `OMEN_CONVERSATION_ID`, `OMEN_SESSION_ID`. */
  readonly env: Readonly<Record<string, string>>;
  /** Appended after the Harness's own system prompt, in order. Fixed for the Session's lifetime. */
  readonly systemPrompt: ReadonlyArray<string>;
  readonly tools: ReadonlyArray<ToolGroup>;
  /** Skill directories to load (Omen's core skill and each Plugin's). */
  readonly skillDirs: ReadonlyArray<string>;
  /** Runs the ToolCall interceptor chain; the Harness calls it before every tool use. */
  readonly interceptToolCall: (request: ToolCallRequest) => Effect.Effect<ToolCallDecision>;
}

/** One long-lived Harness session. It closes when the Scope `open` ran in closes. */
export interface LiveSession {
  /** Starts a Turn, or Steers the Turn in progress. */
  readonly send: (input: string) => Effect.Effect<void, HarnessError>;
  readonly interrupt: Effect.Effect<void, HarnessError>;
  /** Ends when the Session closes. */
  readonly events: Stream.Stream<HarnessEvent>;
}

export interface Harness {
  readonly name: HarnessName;
  readonly open: (
    request: OpenSession,
  ) => Effect.Effect<LiveSession, HarnessError | SessionNotFound, Scope.Scope>;
}
