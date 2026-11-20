import { asc, eq, lte } from "drizzle-orm";
import * as SqliteDrizzle from "drizzle-orm/effect-sqlite-bun";
import { Array, Context, DateTime, Effect, Layer, Option } from "effect";
import { ConversationId } from "@gloaming/sdk/ids";
import type { ScheduleId } from "./schedule.ts";
import { Schedule, ScheduleId as ScheduleIdSchema, ScheduleTiming } from "./schedule.ts";
import { schedulesTable } from "./schedules-table.ts";

type ScheduleRow = typeof schedulesTable.$inferSelect;

const timingOf = (row: ScheduleRow): ScheduleTiming =>
  Option.match(Option.fromNullishOr(row.cron), {
    onSome: (expression) => ScheduleTiming.cases.Cron.make({ expression }),
    onNone: () =>
      ScheduleTiming.cases.Once.make({
        runAt: DateTime.makeUnsafe(Option.getOrThrow(Option.fromNullishOr(row.runAt))),
      }),
  });

const decodeRow = (row: ScheduleRow): Schedule =>
  new Schedule({
    id: ScheduleIdSchema.make(row.id),
    conversationId: ConversationId.make(row.conversationId),
    timing: timingOf(row),
    timeZone: row.timeZone,
    prompt: row.prompt,
    nextRunAt: DateTime.makeUnsafe(row.nextRunAt),
    lastRunAt: Option.map(Option.fromNullishOr(row.lastRunAt), DateTime.makeUnsafe),
    createdAt: DateTime.makeUnsafe(row.createdAt),
  });

const timingColumns = (timing: ScheduleTiming) =>
  ScheduleTiming.match(timing, {
    Cron: ({ expression }) => ({ kind: "cron" as const, cron: expression, runAt: null }),
    Once: ({ runAt }) => ({
      kind: "once" as const,
      cron: null,
      runAt: DateTime.toEpochMillis(runAt),
    }),
  });

export interface NewSchedule {
  readonly conversationId: ConversationId;
  readonly timing: ScheduleTiming;
  readonly timeZone: string;
  readonly prompt: string;
  readonly firstRunAt: DateTime.Utc;
}

/** Schedules in the core database. */
export class ScheduleStore extends Context.Service<
  ScheduleStore,
  {
    readonly add: (schedule: NewSchedule) => Effect.Effect<Schedule>;
    /** By next run, soonest first; one Conversation's, or all. */
    readonly list: (
      conversationId: Option.Option<ConversationId>,
    ) => Effect.Effect<ReadonlyArray<Schedule>>;
    /** Whether a Schedule with that id existed. */
    readonly remove: (id: ScheduleId) => Effect.Effect<boolean>;
    /** Schedules whose next run is at or before `now`. */
    readonly due: (now: DateTime.Utc) => Effect.Effect<ReadonlyArray<Schedule>>;
    readonly soonest: Effect.Effect<Option.Option<DateTime.Utc>>;
    readonly markRun: (
      id: ScheduleId,
      next: DateTime.Utc,
      lastRunAt: Option.Option<DateTime.Utc>,
    ) => Effect.Effect<void>;
  }
>()("@gloaming/plugin-scheduler/ScheduleStore") {
  static readonly layer = Layer.effect(
    ScheduleStore,
    Effect.gen(function* () {
      const db = yield* SqliteDrizzle.makeWithDefaults();

      const add = Effect.fn("ScheduleStore.add")(function* (schedule: NewSchedule) {
        const now = yield* DateTime.now;

        const rows = yield* db
          .insert(schedulesTable)
          .values({
            conversationId: schedule.conversationId,
            ...timingColumns(schedule.timing),
            timeZone: schedule.timeZone,
            prompt: schedule.prompt,
            nextRunAt: DateTime.toEpochMillis(schedule.firstRunAt),
            lastRunAt: null,
            createdAt: DateTime.toEpochMillis(now),
          })
          .returning();

        return yield* Effect.fromOption(Array.head(rows)).pipe(Effect.map(decodeRow));
      }, Effect.orDie);

      const select = (where: ReturnType<typeof lte> | undefined) =>
        db
          .select()
          .from(schedulesTable)
          .where(where)
          .orderBy(asc(schedulesTable.nextRunAt), asc(schedulesTable.id))
          .pipe(Effect.orDie, Effect.map(Array.map(decodeRow)));

      const list = Effect.fn("ScheduleStore.list")(
        (conversationId: Option.Option<ConversationId>) =>
          select(
            Option.getOrUndefined(
              Option.map(conversationId, (id) => eq(schedulesTable.conversationId, id)),
            ),
          ),
      );

      const remove = Effect.fn("ScheduleStore.remove")(function* (id: ScheduleId) {
        const removed = yield* db
          .delete(schedulesTable)
          .where(eq(schedulesTable.id, id))
          .returning({ id: schedulesTable.id });

        return removed.length > 0;
      }, Effect.orDie);

      const due = Effect.fn("ScheduleStore.due")((now: DateTime.Utc) =>
        select(lte(schedulesTable.nextRunAt, DateTime.toEpochMillis(now))),
      );

      const soonest = db
        .select({ nextRunAt: schedulesTable.nextRunAt })
        .from(schedulesTable)
        .orderBy(asc(schedulesTable.nextRunAt))
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) =>
            Option.map(Array.head(rows), (row) => DateTime.makeUnsafe(row.nextRunAt)),
          ),
        );

      const markRun = Effect.fn("ScheduleStore.markRun")(function* (
        id: ScheduleId,
        next: DateTime.Utc,
        lastRunAt: Option.Option<DateTime.Utc>,
      ) {
        yield* db
          .update(schedulesTable)
          .set({
            nextRunAt: DateTime.toEpochMillis(next),
            ...Option.match(lastRunAt, {
              onNone: () => ({}),
              onSome: (ranAt) => ({ lastRunAt: DateTime.toEpochMillis(ranAt) }),
            }),
          })
          .where(eq(schedulesTable.id, id));
      }, Effect.orDie);

      return { add, list, remove, due, soonest, markRun };
    }),
  );
}
