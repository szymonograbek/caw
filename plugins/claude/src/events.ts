import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Match, Option, Schema } from "effect";
import { HarnessEvent, SessionNotFound } from "@gloaming/caw-plugin-sdk/harness";
import { claudeError, claudeHarnessName } from "./claude-error.ts";
import type { ClaudeSessionId } from "./cursor.ts";
import { encodeCursor, ClaudeSessionId as ClaudeSessionIdSchema } from "./cursor.ts";

/** The session id the mapping last reported as `CursorUpdated`. */
export type ReportedSession = Option.Option<ClaudeSessionId>;

/** The CLI's error when `resume` names a session it does not have. */
const sessionNotFoundPrefix = "No conversation found with session ID";

const isJson = Schema.is(Schema.Json);

const harnessError = (message: string) => claudeError(message, undefined);

/**
 * Maps one SDK message to the Harness events it carries. Subagent traffic
 * (`parent_tool_use_id` set) stays inside its Task tool call.
 */
export const toHarnessEvents = (
  reported: ReportedSession,
  message: SDKMessage,
): readonly [ReportedSession, ReadonlyArray<HarnessEvent>] =>
  Match.value(message).pipe(
    Match.when({ type: "system", subtype: "init" }, ({ session_id }) =>
      cursorEvents(reported, ClaudeSessionIdSchema.make(session_id)),
    ),
    Match.when(
      { type: "assistant" },
      (assistant) => [reported, assistantEvents(assistant)] as const,
    ),
    Match.when({ type: "user" }, (user) => [reported, toolResultEvents(user)] as const),
    Match.when({ type: "result" }, (result) => [reported, [resultEvent(result)]] as const),
    Match.orElse(() => [reported, []] as const),
  );

const cursorEvents = (
  reported: ReportedSession,
  sessionId: ClaudeSessionId,
): readonly [ReportedSession, ReadonlyArray<HarnessEvent>] =>
  Option.contains(reported, sessionId)
    ? [reported, []]
    : [Option.some(sessionId), [HarnessEvent.CursorUpdated({ cursor: encodeCursor(sessionId) })]];

const assistantEvents = (message: SDKAssistantMessage): ReadonlyArray<HarnessEvent> =>
  message.parent_tool_use_id === null
    ? message.message.content.flatMap((block) =>
        Match.value(block).pipe(
          Match.when({ type: "text" }, ({ text }): ReadonlyArray<HarnessEvent> => [
            HarnessEvent.Text({ text }),
          ]),
          Match.when({ type: "tool_use" }, ({ id, name, input }): ReadonlyArray<HarnessEvent> => [
            isJson(input)
              ? HarnessEvent.ToolCall({ id, name, input })
              : HarnessEvent.Failed({ error: harnessError(`Tool ${name} input is not JSON`) }),
          ]),
          Match.orElse((): ReadonlyArray<HarnessEvent> => []),
        ),
      )
    : [];

const toolResultEvents = (message: SDKUserMessage): ReadonlyArray<HarnessEvent> =>
  message.parent_tool_use_id === null
    ? Match.value(message.message.content).pipe(
        Match.when(Match.string, (): ReadonlyArray<HarnessEvent> => []),
        Match.orElse((blocks) =>
          blocks.flatMap((block) =>
            block.type === "tool_result"
              ? [
                  HarnessEvent.ToolResult({
                    id: block.tool_use_id,
                    output: toolOutput(block.content),
                    isError: block.is_error === true,
                  }),
                ]
              : [],
          ),
        ),
      )
    : [];

type ToolResultContent = Extract<
  Exclude<SDKUserMessage["message"]["content"], string>[number],
  { type: "tool_result" }
>["content"];

const toolOutput = (content: ToolResultContent): string =>
  Match.value(content).pipe(
    Match.when(Match.undefined, () => ""),
    Match.when(Match.string, (text) => text),
    Match.orElse((blocks) =>
      blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
    ),
  );

const resultEvent = (result: SDKResultMessage): HarnessEvent =>
  Match.value(result).pipe(
    Match.when({ subtype: "success", is_error: false }, () => HarnessEvent.TurnEnded()),
    // `interrupt` aborted the Turn: it stopped as asked rather than failed.
    Match.when({ terminal_reason: Match.is("aborted_streaming", "aborted_tools") }, () =>
      HarnessEvent.TurnEnded(),
    ),
    Match.when({ subtype: "success" }, ({ result: text }) =>
      HarnessEvent.Failed({ error: harnessError(text) }),
    ),
    Match.orElse(({ errors, subtype }) =>
      HarnessEvent.Failed({
        error: errors.some((error) => error.startsWith(sessionNotFoundPrefix))
          ? new SessionNotFound({ harness: claudeHarnessName })
          : harnessError(errors.length > 0 ? errors.join("\n") : subtype),
      }),
    ),
  );
