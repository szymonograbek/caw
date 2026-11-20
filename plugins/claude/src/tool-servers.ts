import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { Effect, Schema } from "effect";
import type { HarnessError } from "@caw/sdk/harness";
import type { Tool, ToolContext, ToolGroup } from "@caw/sdk/tool";
import { ToolError } from "@caw/sdk/tool";
import { z } from "zod";
import { claudeError } from "./claude-error.ts";

/** Runs a tool call on the Session's fiber set, so closing the Session cancels it. */
export type RunToolCall = (effect: Effect.Effect<ToolOutput>) => Promise<ToolOutput>;

// A type alias, not an interface, so it fits the SDK's index-signature `CallToolResult`.
type ToolOutput = {
  readonly content: Array<{ readonly type: "text"; readonly text: string }>;
  readonly isError: boolean;
};

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);

/**
 * One always-loaded in-process MCP server per ToolGroup, keyed by its
 * `caw_<plugin>` name as `mcpServers` expects.
 */
export const toolServers = Effect.fn("ClaudeHarness.toolServers")(function* (
  groups: ReadonlyArray<ToolGroup>,
  context: ToolContext,
  runToolCall: RunToolCall,
) {
  const servers: Record<string, McpSdkServerConfigWithInstance> = {};

  for (const group of groups) {
    const name = `caw_${group.plugin}`;

    const tools = yield* Effect.forEach(group.tools, (tool) =>
      toolDefinition(tool, context, runToolCall),
    );

    servers[name] = createSdkMcpServer({ name, tools, alwaysLoad: true });
  }

  return servers;
});

const toolDefinition = (
  tool: Tool,
  context: ToolContext,
  runToolCall: RunToolCall,
): Effect.Effect<SdkMcpToolDefinition, HarnessError> =>
  zodParameters(tool).pipe(
    Effect.map((inputSchema) => ({
      name: tool.name,
      description: tool.description,
      inputSchema,
      handler: (args) =>
        runToolCall(
          decodeJson(args).pipe(
            Effect.mapError((issue) => new ToolError({ message: issue.message })),
            Effect.flatMap((input) => tool.run(input, context)),
            Effect.match({
              onSuccess: (text) => toolOutput(text, false),
              onFailure: (error) => toolOutput(error.message, true),
            }),
          ),
        ),
    })),
  );

const toolOutput = (text: string, isError: boolean): ToolOutput => ({
  content: [{ type: "text", text }],
  isError,
});

/**
 * The SDK only takes Zod object shapes, so the tool's JSON Schema goes back
 * into Zod instead of a hand-written Zod copy per tool.
 */
const zodParameters = (
  tool: Tool,
): Effect.Effect<SdkMcpToolDefinition["inputSchema"], HarnessError> =>
  Effect.try({
    try: () => z.fromJSONSchema(tool.inputSchema),
    catch: (cause) => claudeError(`Tool ${tool.name} parameters have no JSON Schema`, cause),
  }).pipe(
    Effect.flatMap((schema) =>
      schema instanceof z.ZodObject
        ? Effect.succeed(schema.shape)
        : Effect.fail(claudeError(`Tool ${tool.name} parameters must be an object schema`, schema)),
    ),
  );
