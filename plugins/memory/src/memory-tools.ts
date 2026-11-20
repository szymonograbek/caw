import { Effect, Schema } from "effect";
import type { Tool, ToolContext } from "@gloaming/caw-plugin-sdk/tool";
import { makeTool, ToolError } from "@gloaming/caw-plugin-sdk/tool";
import type { Memory, MemoryNotFound, MemoryScopeFull, MemoryTooLong } from "./memory.ts";
import {
  maxBodyLength,
  maxTitleLength,
  MemoryId,
  MemoryScope,
  memoriesPerScope,
  scopeLabel,
} from "./memory.ts";
import { MemoryStore } from "./memory-store.ts";
import { pinnedBudget, renderPinned } from "./pinned-memories.ts";

const ScopeParam = Schema.Literals(["global", "conversation"]).annotate({
  description:
    "`conversation` (this top-level Conversation and its threads) or `global` (every Conversation)",
});

const IdParam = MemoryId.annotate({ description: "The Memory's id, as memory_list shows it" });

const toScope = (scope: typeof ScopeParam.Type, context: ToolContext): MemoryScope =>
  scope === "global"
    ? MemoryScope.cases.Global.make({})
    : MemoryScope.cases.Conversation.make({ conversationId: context.rootConversationId });

const scopeName = (scope: MemoryScope): string =>
  MemoryScope.match(scope, {
    Global: () => "The global scope",
    Conversation: () => "This Conversation",
  });

const describeMemory = (memory: Memory): string =>
  `#${memory.id} (${scopeLabel(memory.scope)}${memory.pinned ? ", pinned" : ""}) ${memory.title}`;

const notFound = (error: MemoryNotFound) =>
  new ToolError({
    message: `No Memory #${error.id} is visible here. memory_list shows the ids you can use.`,
  });

const tooLong = (error: MemoryTooLong) =>
  new ToolError({
    message:
      error.field === "body"
        ? `The body is ${error.length} characters; the cap is ${maxBodyLength}. Keep only the durable fact, or split it into separate Memories.`
        : `The title is ${error.length} characters; the cap is ${maxTitleLength}.`,
  });

const scopeFull = (error: MemoryScopeFull) =>
  new ToolError({
    message: `${scopeName(error.scope)} already holds ${memoriesPerScope} Memories, the cap. Merge related Memories with memory_update or remove stale ones with memory_forget, then save again.`,
  });

/** The agent's Memory tools. Conversation scope always means the top-level Conversation. */
export const memoryTools = Effect.gen(function* () {
  const store = yield* MemoryStore;

  const save = makeTool({
    name: "memory_save",
    description: `Save a short, durable fact worth remembering in later Sessions. At most ${memoriesPerScope} Memories per scope and ${maxBodyLength} characters per body. Pinned Memories are in every new Session's system prompt; keep pins for what you need every time.`,
    parameters: Schema.Struct({
      scope: ScopeParam,
      title: Schema.String.annotate({ description: "A short title that identifies the fact" }),
      body: Schema.String,
      pinned: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
    }),
    handler: ({ scope, ...draft }, context) =>
      store.save(toScope(scope, context), draft).pipe(
        Effect.map((memory) => `Saved ${describeMemory(memory)}.`),
        Effect.catchTags({
          MemoryScopeFull: (error) => Effect.fail(scopeFull(error)),
          MemoryTooLong: (error) => Effect.fail(tooLong(error)),
        }),
      ),
  });

  const update = makeTool({
    name: "memory_update",
    description: "Change a Memory's title, body, or both. Use it to merge or correct Memories.",
    parameters: Schema.Struct({
      id: IdParam,
      title: Schema.OptionFromOptionalKey(Schema.String),
      body: Schema.OptionFromOptionalKey(Schema.String),
    }),
    handler: ({ id, ...changes }, context) =>
      store.update(context.rootConversationId, id, changes).pipe(
        Effect.map((memory) => `Updated ${describeMemory(memory)}.`),
        Effect.catchTags({
          MemoryNotFound: (error) => Effect.fail(notFound(error)),
          MemoryTooLong: (error) => Effect.fail(tooLong(error)),
        }),
      ),
  });

  const forget = makeTool({
    name: "memory_forget",
    description: "Delete a Memory for good.",
    parameters: Schema.Struct({ id: IdParam }),
    handler: ({ id }, context) =>
      store.forget(context.rootConversationId, id).pipe(
        Effect.map(() => `Forgot Memory #${id}.`),
        Effect.catchTag("MemoryNotFound", (error) => Effect.fail(notFound(error))),
      ),
  });

  const list = makeTool({
    name: "memory_list",
    description:
      "List the ids and titles of every Memory visible here: global ones and this Conversation's.",
    parameters: Schema.Struct({}),
    handler: (_, context) =>
      store
        .visible(context.rootConversationId)
        .pipe(
          Effect.map((memories) =>
            memories.length === 0 ? "No Memories yet." : memories.map(describeMemory).join("\n"),
          ),
        ),
  });

  const read = makeTool({
    name: "memory_read",
    description: "Read a Memory's full body.",
    parameters: Schema.Struct({ id: IdParam }),
    handler: ({ id }, context) =>
      store.read(context.rootConversationId, id).pipe(
        Effect.map((memory) => `${describeMemory(memory)}\n\n${memory.body}`),
        Effect.catchTag("MemoryNotFound", (error) => Effect.fail(notFound(error))),
      ),
  });

  const pin = makeTool({
    name: "memory_pin",
    description: `Pin a Memory so every new Session starts with it in context, or unpin it. Pinned Memories share a ${pinnedBudget}-character budget. Sessions already running keep their prompt.`,
    parameters: Schema.Struct({ id: IdParam, pinned: Schema.Boolean }),
    handler: ({ id, pinned }, context) =>
      Effect.gen(function* () {
        const memory = yield* store.pin(context.rootConversationId, id, pinned);
        const nowPinned = yield* store.pinned(context.rootConversationId);
        const { omitted } = renderPinned(nowPinned);

        const overflow =
          omitted > 0
            ? ` ${omitted} pinned Memories no longer fit the ${pinnedBudget}-character budget; unpin or shorten some.`
            : "";

        return `${pinned ? "Pinned" : "Unpinned"} ${describeMemory(memory)}.${overflow}`;
      }).pipe(Effect.catchTag("MemoryNotFound", (error) => Effect.fail(notFound(error)))),
  });

  const tools: ReadonlyArray<Tool> = [save, update, forget, list, read, pin];

  return tools;
});
