import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ToolCallRequest } from "@gloaming/sdk/harness";
import { ToolCallDecision } from "@gloaming/sdk/harness";
import { SessionId } from "@gloaming/sdk/ids";
import { preToolUse } from "./pre-tool-use.ts";

const sessionId = SessionId.make("session-1");

const bashCall: HookInput = {
  hook_event_name: "PreToolUse",
  session_id: "claude-session",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/tmp",
  tool_name: "Bash",
  tool_input: { command: "rm -rf /" },
  tool_use_id: "toolu_1",
};

const deciding = (decision: ToolCallDecision) => {
  const requests: Array<ToolCallRequest> = [];

  const request = {
    sessionId,
    interceptToolCall: (toolCall: ToolCallRequest) =>
      Effect.sync(() => requests.push(toolCall)).pipe(Effect.as(decision)),
  };

  return { requests, run: (input: HookInput) => preToolUse(request, input) };
};

describe("preToolUse", () => {
  it.effect("asks the interceptor chain about the tool call and allows it unchanged", () =>
    Effect.gen(function* () {
      const hook = deciding(ToolCallDecision.Allow());

      expect(yield* hook.run(bashCall)).toEqual({});
      expect(hook.requests).toEqual([{ sessionId, name: "Bash", input: { command: "rm -rf /" } }]);
    }),
  );

  it.effect("denies a blocked call with the interceptor's reason", () =>
    Effect.gen(function* () {
      const output = yield* deciding(ToolCallDecision.Block({ reason: "not here" })).run(bashCall);

      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "not here",
        },
      });
    }),
  );

  it.effect("replaces the input of a mutated call", () =>
    Effect.gen(function* () {
      const output = yield* deciding(ToolCallDecision.Mutate({ input: { command: "ls" } })).run(
        bashCall,
      );

      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { command: "ls" },
        },
      });
    }),
  );

  it.effect("denies a mutation to a non-object input", () =>
    Effect.gen(function* () {
      const output = yield* deciding(ToolCallDecision.Mutate({ input: "ls" })).run(bashCall);

      expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    }),
  );
});
