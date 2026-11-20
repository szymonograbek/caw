import { Effect, Layer, Option, Schema } from "effect";
import { PluginName } from "@gloaming/sdk/ids";
import { definePlugin, Caw } from "@gloaming/sdk/plugin";
import { scheduleGuide } from "./guide.ts";
import { scheduleCommand } from "./schedule-command.ts";
import { ScheduleStore } from "./schedule-store.ts";
import { Scheduler } from "./scheduler.ts";
import { schedulerMigrations } from "./schedules-table.ts";

const schedulerLayer = Scheduler.layer.pipe(Layer.provide(ScheduleStore.layer));

const pluginLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const caw = yield* Caw;
    const command = yield* scheduleCommand;

    yield* caw.registerCliCommand(command);
  }),
).pipe(Layer.provide(schedulerLayer));

export default definePlugin({
  name: PluginName.make("scheduler"),
  settings: Schema.Struct({}),
  migrations: schedulerMigrations,
  guide: [scheduleGuide],
  skillDir: Option.none(),
  layer: () => pluginLayer,
});
