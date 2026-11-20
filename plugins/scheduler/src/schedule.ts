import { Cron, DateTime, Duration, Option, Result, Schema } from "effect";
import { ConversationId } from "@caw/sdk/ids";

export const ScheduleId = Schema.Int.pipe(Schema.brand("ScheduleId"));

export type ScheduleId = typeof ScheduleId.Type;

/** When a Schedule fires: on every match of a cron expression, or once. */
export const ScheduleTiming = Schema.TaggedUnion({
  Cron: { expression: Schema.String },
  Once: { runAt: Schema.DateTimeUtc },
});

export type ScheduleTiming = typeof ScheduleTiming.Type;

export class Schedule extends Schema.Class<Schedule, { readonly brand: unique symbol }>("Schedule")(
  {
    id: ScheduleId,
    conversationId: ConversationId,
    timing: ScheduleTiming,
    /** The IANA zone cron fields are read in, and times are shown in. */
    timeZone: Schema.String,
    prompt: Schema.String,
    nextRunAt: Schema.DateTimeUtc,
    lastRunAt: Schema.Option(Schema.DateTimeUtc),
    createdAt: Schema.DateTimeUtc,
  },
) {}

/** A run missed by more than this (the daemon was down) is skipped, not caught up. */
const catchUpWindow = Duration.hours(24);

/** Parses a cron expression in a time zone; the message says what is wrong. */
export const parseCron = (expression: string, timeZone: string) =>
  Cron.parse(expression, timeZone).pipe(Result.mapError((error) => error.message));

const cronOf = (expression: string, timeZone: string): Cron.Cron =>
  Result.getOrThrowWith(parseCron(expression, timeZone), (message) => message);

/** The first run strictly after `after`, or none for a one-off Schedule. */
export const nextRun = (
  timing: ScheduleTiming,
  timeZone: string,
  after: DateTime.Utc,
): Option.Option<DateTime.Utc> =>
  ScheduleTiming.match(timing, {
    Cron: ({ expression }) =>
      Option.some(DateTime.fromDateUnsafe(Cron.next(cronOf(expression, timeZone), after))),
    Once: () => Option.none(),
  });

/** What to do with a Schedule whose `nextRunAt` has passed. */
export interface DueRun {
  /** False when even the latest missed run is older than the catch-up window. */
  readonly deliver: boolean;
  /** The next future run; none means the Schedule is done and is removed. */
  readonly next: Option.Option<DateTime.Utc>;
}

/**
 * At most one run is delivered however many were missed, and only if the
 * latest missed run is within the catch-up window. The Schedule then moves to
 * its first run after `now`.
 */
export const dueRun = (schedule: Schedule, now: DateTime.Utc): DueRun => {
  const latestMissed = ScheduleTiming.match(schedule.timing, {
    Cron: ({ expression }) =>
      DateTime.max(
        schedule.nextRunAt,
        // `prev` is strictly before its argument; one millisecond later includes `now` itself.
        DateTime.fromDateUnsafe(
          Cron.prev(cronOf(expression, schedule.timeZone), DateTime.add(now, { milliseconds: 1 })),
        ),
      ),
    Once: ({ runAt }) => runAt,
  });

  return {
    deliver: Duration.isLessThanOrEqualTo(DateTime.distance(latestMissed, now), catchUpWindow),
    next: nextRun(schedule.timing, schedule.timeZone, now),
  };
};
