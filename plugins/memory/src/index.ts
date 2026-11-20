import { Effect, Layer, Option, Schema } from "effect";
import { PluginName } from "@gloaming/sdk/ids";
import { Interceptor } from "@gloaming/sdk/interceptors";
import { definePlugin, Caw } from "@gloaming/sdk/plugin";
import { memoryGuide } from "./guide.ts";
import { memoryMigrations } from "./memories-table.ts";
import { memoryCommand } from "./memory-command.ts";
import { MemoryStore } from "./memory-store.ts";
import { memoryTools } from "./memory-tools.ts";
import { renderPinned } from "./pinned-memories.ts";

const pluginLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const caw = yield* Caw;
    const store = yield* MemoryStore;
    const tools = yield* memoryTools;
    const command = yield* memoryCommand;

    yield* Effect.forEach(tools, caw.registerTool);
    yield* caw.registerCliCommand(command);
    yield* caw.registerInterceptor(
      Interceptor.SessionOpening({
        handle: ({ root }) =>
          store.pinned(root.id).pipe(
            Effect.map((pinned) => ({
              systemPrompt: Option.toArray(renderPinned(pinned).section),
              tools: [],
              env: {},
            })),
          ),
      }),
    );
  }),
).pipe(Layer.provide(MemoryStore.layer));

export default definePlugin({
  name: PluginName.make("memory"),
  settings: Schema.Struct({}),
  migrations: memoryMigrations,
  guide: [memoryGuide],
  skillDir: Option.none(),
  layer: () => pluginLayer,
});
