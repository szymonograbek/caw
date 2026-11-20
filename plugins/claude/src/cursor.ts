import { Effect, Schema } from "effect";
import type { ResumeCursor } from "@omen/sdk/harness";
import type { HarnessError } from "@omen/sdk/harness";
import { claudeError } from "./claude-error.ts";

/** The Claude Code session id behind a Session's resume cursor. */
export const ClaudeSessionId = Schema.String.pipe(Schema.brand("ClaudeSessionId"));

export type ClaudeSessionId = typeof ClaudeSessionId.Type;

const ClaudeCursor = Schema.Struct({ sessionId: ClaudeSessionId });

export const encodeCursor = (sessionId: ClaudeSessionId): ResumeCursor =>
  Schema.encodeSync(ClaudeCursor)({ sessionId });

export const decodeCursor = (cursor: ResumeCursor): Effect.Effect<ClaudeSessionId, HarnessError> =>
  Schema.decodeUnknownEffect(ClaudeCursor)(cursor).pipe(
    Effect.map(({ sessionId }) => sessionId),
    Effect.mapError((issue) => claudeError(`Invalid resume cursor: ${issue.message}`, issue)),
  );
