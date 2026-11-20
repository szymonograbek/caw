import type { HookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { Effect, Match, Schema } from "effect";
import type { OpenSession } from "@gloaming/caw-plugin-sdk/harness";
import { ToolCallDecision } from "@gloaming/caw-plugin-sdk/harness";

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);

const isJsonObject = Schema.is(Schema.JsonObject);

const deny = (reason: string): SyncHookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
});

/** Answers Claude's `PreToolUse` hook with the Session's ToolCall interceptor chain. */
export const preToolUse = (
  request: Pick<OpenSession, "sessionId" | "interceptToolCall">,
  input: HookInput,
): Effect.Effect<SyncHookJSONOutput> =>
  Match.value(input).pipe(
    Match.when({ hook_event_name: "PreToolUse" }, ({ tool_name, tool_input }) =>
      decodeJson(tool_input).pipe(
        Effect.flatMap((toolInput) =>
          request.interceptToolCall({
            sessionId: request.sessionId,
            name: tool_name,
            input: toolInput,
          }),
        ),
        Effect.map(decisionOutput),
        Effect.catch((issue) => Effect.succeed(deny(`Tool input is not JSON: ${issue.message}`))),
      ),
    ),
    Match.orElse(() => Effect.succeed({})),
  );

const decisionOutput = (decision: ToolCallDecision): SyncHookJSONOutput =>
  ToolCallDecision.$match(decision, {
    Allow: () => ({}),
    Block: ({ reason }) => deny(reason),
    Mutate: ({ input }) =>
      isJsonObject(input)
        ? allowWith(input)
        : deny("A ToolCall interceptor replaced the input with a non-object"),
  });

const allowWith = (updatedInput: Schema.JsonObject): SyncHookJSONOutput => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput },
});
