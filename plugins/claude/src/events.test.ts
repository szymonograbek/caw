import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { HarnessEvent, SessionNotFound } from "@omen/sdk/harness";
import { claudeError, claudeHarnessName } from "./claude-error.ts";
import { ClaudeSessionId, encodeCursor } from "./cursor.ts";
import type { ReportedSession } from "./events.ts";
import { toHarnessEvents } from "./events.ts";

const uuid = "00000000-0000-4000-8000-000000000001";

type AssistantContent = SDKAssistantMessage["message"]["content"];

type UserContent = SDKUserMessage["message"]["content"];

const init = (sessionId: string): SDKMessage => {
  const message: SDKSystemMessage = {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "test",
    cwd: "/tmp",
    tools: [],
    mcp_servers: [],
    model: "sonnet",
    permissionMode: "bypassPermissions",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    uuid,
    session_id: sessionId,
  };

  return message;
};

const assistant = (content: AssistantContent, parentToolUseId: string | null): SDKMessage => ({
  type: "assistant",
  message: {
    id: "msg_1",
    container: null,
    content,
    context_management: null,
    diagnostics: null,
    model: "sonnet",
    role: "assistant",
    stop_details: null,
    stop_reason: null,
    stop_sequence: null,
    type: "message",
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      fallback_credit: null,
      inference_geo: null,
      input_tokens: 0,
      iterations: null,
      output_tokens: 0,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    },
  },
  parent_tool_use_id: parentToolUseId,
  uuid,
  session_id: "s-1",
});

const user = (content: UserContent, parentToolUseId: string | null): SDKMessage => ({
  type: "user",
  message: { role: "user", content },
  parent_tool_use_id: parentToolUseId,
});

const resultBase = {
  duration_ms: 0,
  duration_api_ms: 0,
  is_error: true,
  num_turns: 1,
  stop_reason: null,
  total_cost_usd: 0,
  usage: {
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: null,
    inference_geo: "",
    input_tokens: 0,
    iterations: [],
    output_tokens: 0,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: "standard",
    speed: "standard",
  },
  modelUsage: {},
  permission_denials: [],
  uuid,
  session_id: "s-1",
} satisfies Partial<SDKResultMessage>;

const success = (isError: boolean, result: string): SDKMessage => ({
  ...resultBase,
  type: "result",
  subtype: "success",
  is_error: isError,
  result,
});

const executionError = (
  errors: Array<string>,
  terminalReason: "aborted_streaming" | "api_error",
): SDKMessage => ({
  ...resultBase,
  type: "result",
  subtype: "error_during_execution",
  errors,
  terminal_reason: terminalReason,
});

/** Folds a message trace through the mapping, as the Harness's event stream does. */
const mapTrace = (messages: ReadonlyArray<SDKMessage>): ReadonlyArray<HarnessEvent> => {
  let reported: ReportedSession = Option.none();
  const events: Array<HarnessEvent> = [];

  for (const message of messages) {
    const [next, mapped] = toHarnessEvents(reported, message);

    reported = next;
    events.push(...mapped);
  }

  return events;
};

const failed = (message: string) => HarnessEvent.Failed({ error: claudeError(message, undefined) });

const cursor = (sessionId: string) =>
  HarnessEvent.CursorUpdated({ cursor: encodeCursor(ClaudeSessionId.make(sessionId)) });

describe("toHarnessEvents", () => {
  it("reports each new session id once as a cursor", () => {
    const events = mapTrace([init("s-1"), init("s-1"), init("s-2")]);

    expect(events).toEqual([cursor("s-1"), cursor("s-2")]);
  });

  it("maps a turn with a tool call to text, tool call, tool result and turn end", () => {
    const events = mapTrace([
      assistant(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "echo hi" },
            caller: { type: "direct" },
          },
        ],
        null,
      ),
      user(
        [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "hi" }] }],
        null,
      ),
      assistant([{ type: "text", text: "It printed hi.", citations: null }], null),
      success(false, "It printed hi."),
    ]);

    expect(events).toEqual([
      HarnessEvent.ToolCall({ id: "toolu_1", name: "Bash", input: { command: "echo hi" } }),
      HarnessEvent.ToolResult({ id: "toolu_1", output: "hi", isError: false }),
      HarnessEvent.Text({ text: "It printed hi." }),
      HarnessEvent.TurnEnded(),
    ]);
  });

  it("reports a blocked tool's string result as an error", () => {
    const events = mapTrace([
      user(
        [{ type: "tool_result", tool_use_id: "toolu_2", content: "blocked", is_error: true }],
        null,
      ),
    ]);

    expect(events).toEqual([
      HarnessEvent.ToolResult({ id: "toolu_2", output: "blocked", isError: true }),
    ]);
  });

  it("ignores subagent traffic and plain user prompts", () => {
    const events = mapTrace([
      assistant([{ type: "text", text: "inside a subagent", citations: null }], "toolu_task"),
      user([{ type: "tool_result", tool_use_id: "toolu_3", content: "x" }], "toolu_task"),
      user("a prompt", null),
    ]);

    expect(events).toEqual([]);
  });

  it("fails the turn when a successful result is an error", () => {
    const events = mapTrace([success(true, "API Error: overloaded")]);

    expect(events).toEqual([failed("API Error: overloaded")]);
  });

  it("ends an interrupted turn instead of failing it", () => {
    const events = mapTrace([
      executionError(["[ede_diagnostic] result_type=user"], "aborted_streaming"),
    ]);

    expect(events).toEqual([HarnessEvent.TurnEnded()]);
  });

  it("reports a failed resume as SessionNotFound", () => {
    const events = mapTrace([
      executionError(
        ["No conversation found with session ID: 00000000-0000-4000-8000-000000000000"],
        "api_error",
      ),
    ]);

    expect(events).toEqual([
      HarnessEvent.Failed({ error: new SessionNotFound({ harness: claudeHarnessName }) }),
    ]);
  });

  it("reports other execution errors as HarnessError", () => {
    const events = mapTrace([executionError(["boom"], "api_error")]);

    expect(events).toEqual([failed("boom")]);
  });
});
