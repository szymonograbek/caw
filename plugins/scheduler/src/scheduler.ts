import { Context, DateTime, Duration, Effect, Layer, Option, Queue } from "effect";
import type { ConversationId } from "@gloaming/sdk/ids";
import { Caw } from "@gloaming/sdk/plugin";
import type { Schedule, ScheduleId } from "./schedule.ts";
import { dueRun } from "./schedule.ts";
import type { NewSchedule } from "./schedule-store.ts";
import { ScheduleStore } from "./schedule-store.ts";

/**
 * Owns Schedules and the fiber that fires them. The fiber lives in the
 * Plugin's scope, sleeping until the soonest run or until Schedules change.
 */
export class Scheduler extends Context.Service<
  Scheduler,
  {
    readonly add: (schedule: NewSchedule) => Effect.Effect<Schedule>;
    readonly list: (
      conversationId: Option.Option<ConversationId>,
    ) => Effect.Effect<ReadonlyArray<Schedule>>;
    readonly remove: (id: ScheduleId) => Effect.Effect<boolean>;
  }
>()("@gloaming/plugin-scheduler/Scheduler") {
  static readonly layer = Layer.effect(
    Scheduler,
    Effect.gen(function* () {
      const caw = yield* Caw;
      const store = yield* ScheduleStore;
      const changed = yield* Queue.sliding<void>(1);
      const signalChange = Queue.offer(changed, undefined);

      const fire = Effect.fn("Scheduler.fire")(function* (schedule: Schedule, now: DateTime.Utc) {
        yield* Effect.annotateCurrentSpan({ scheduleId: schedule.id });
        const run = dueRun(schedule, now);

        // Move on before delivering, so a crash mid-delivery never repeats a run.
        yield* Option.match(run.next, {
          onNone: () => store.remove(schedule.id),
          onSome: (next) =>
            store.markRun(schedule.id, next, run.deliver ? Option.some(now) : Option.none()),
        });

        const deliver = caw
          .deliverTask(schedule.conversationId, schedule.prompt)
          .pipe(
            Effect.catchTag("ConversationNotFound", () =>
              Effect.logWarning("Removed a Schedule whose Conversation is gone").pipe(
                Effect.andThen(store.remove(schedule.id)),
              ),
            ),
          );

        yield* run.deliver
          ? deliver
          : Effect.logInfo("Skipped a Schedule run missed by more than 24h");
      });

      const untilNextChange = Effect.gen(function* () {
        const now = yield* DateTime.now;
        const due = yield* store.due(now);

        yield* Effect.forEach(due, (schedule) => fire(schedule, now), { discard: true });

        const soonest = yield* store.soonest;

        yield* Option.match(soonest, {
          onNone: () => Queue.take(changed),
          onSome: (at) =>
            Effect.raceFirst(
              Effect.sleep(Duration.max(DateTime.distance(now, at), Duration.zero)),
              Queue.take(changed),
            ),
        });
      });

      yield* Effect.forkScoped(Effect.forever(untilNextChange));

      return {
        add: (schedule) => store.add(schedule).pipe(Effect.tap(signalChange)),
        list: store.list,
        remove: (id) => store.remove(id).pipe(Effect.tap(signalChange)),
      };
    }),
  );
}
