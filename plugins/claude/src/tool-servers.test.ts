import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { ConversationId, PluginName, SessionId } from "@gloaming/caw-plugin-sdk/ids";
import { makeTool } from "@gloaming/caw-plugin-sdk/tool";
import { toolServers } from "./tool-servers.ts";

const context = {
  conversationId: ConversationId.make("c-1"),
  rootConversationId: ConversationId.make("c-1"),
  sessionId: SessionId.make("s-1"),
};

const echo = makeTool({
  name: "echo",
  description: "Echoes its input.",
  parameters: Schema.Struct({ word: Schema.String }),
  handler: ({ word }) => Effect.succeed(word),
});

const ping = makeTool({
  name: "ping",
  description: "Takes no parameters.",
  parameters: Schema.Struct({}),
  handler: () => Effect.succeed("pong"),
});

const runToolCall = Effect.runPromise;

describe("toolServers", () => {
  it.effect("serves each Plugin's tools as its own caw_<plugin> MCP server", () =>
    Effect.gen(function* () {
      const servers = yield* toolServers(
        [
          { plugin: PluginName.make("memory"), tools: [echo] },
          { plugin: PluginName.make("scheduler"), tools: [echo] },
        ],
        context,
        runToolCall,
      );

      expect(Object.keys(servers)).toEqual(["caw_memory", "caw_scheduler"]);
      expect(servers["caw_memory"]).toMatchObject({ type: "sdk", name: "caw_memory" });
    }),
  );

  it.effect("serves a tool that takes no parameters", () =>
    Effect.gen(function* () {
      const servers = yield* toolServers(
        [{ plugin: PluginName.make("memory"), tools: [ping] }],
        context,
        runToolCall,
      );

      expect(Object.keys(servers)).toEqual(["caw_memory"]);
    }),
  );
});
