import { Effect, Schema } from "effect";
import type * as JsonSchema from "effect/JsonSchema";
import type { ConversationId, PluginName, SessionId } from "./ids.ts";

/** Who is calling a tool. Tools act on the caller's Conversation unless told otherwise. */
export interface ToolContext {
  readonly conversationId: ConversationId;
  /** The top-level Conversation that owns Workspace, profile and Memory (equals `conversationId` outside threads). */
  readonly rootConversationId: ConversationId;
  readonly sessionId: SessionId;
}

/** A failure the agent sees as the tool's error result. */
export class ToolError extends Schema.TaggedError<ToolError, { readonly brand: unique symbol }>()(
  "ToolError",
  {
    message: Schema.String,
  },
) {}

/**
 * A Harness-agnostic tool: Effect Schema parameters plus an Effect handler.
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  /**
   * JSON Schema of the input, always an object (MCP requires one), with
   * shared definitions under `$defs`. It describes the JSON form `run` decodes.
   */
  readonly inputSchema: JsonSchema.JsonSchema;
  /** Decodes the raw input against `parameters`, then runs the handler. */
  readonly run: (input: Schema.Json, context: ToolContext) => Effect.Effect<string, ToolError>;
}

/** Tools grouped by the Plugin that owns them; Claude maps each group to one `omen_<plugin>` MCP server. */
export interface ToolGroup {
  readonly plugin: PluginName;
  readonly tools: ReadonlyArray<Tool>;
}

/** Fields a tool can decode without extra services. */
type ToolFields = Record<string, Schema.Top & { readonly DecodingServices: never }>;

/**
 * Effect renders an empty Struct as "any non-null value"; a tool without
 * parameters still takes an (empty) object.
 */
const objectSchema = (parameters: Schema.Struct<ToolFields>): JsonSchema.JsonSchema => {
  if (Object.keys(parameters.fields).length === 0) {
    return { type: "object", properties: {}, additionalProperties: false };
  }

  const document = Schema.toJsonSchemaDocument(parameters);

  return { ...document.schema, $defs: document.definitions };
};

export const makeTool = <const Fields extends ToolFields>(definition: {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema.Struct<Fields>;
  readonly handler: (
    params: Schema.Struct<Fields>["Type"],
    context: ToolContext,
  ) => Effect.Effect<string, ToolError>;
}): Tool => {
  // Decode the JSON form: the model sees the JSON Schema of the JSON codec.
  const decode = Schema.decodeUnknownEffect(Schema.toCodecJson(definition.parameters));

  return {
    name: definition.name,
    description: definition.description,
    inputSchema: objectSchema(definition.parameters),
    run: (input, context) =>
      decode(input).pipe(
        Effect.mapError((issue) => new ToolError({ message: `Invalid input: ${issue.message}` })),
        Effect.flatMap((params) => definition.handler(params, context)),
      ),
  };
};
