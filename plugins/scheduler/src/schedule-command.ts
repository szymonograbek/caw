import { Console, DateTime, Effect, Option, Result } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { CurrentCliContext, fromCommand } from "@omen/sdk/cli-command";
import { ConversationId } from "@omen/sdk/ids";
import { CliCommandError, Omen } from "@omen/sdk/plugin";
import type { Schedule } from "./schedule.ts";
import { nextRun, parseCron, ScheduleId, ScheduleTiming } from "./schedule.ts";
import { Scheduler } from "./scheduler.ts";

const usageError = (message: string) => new CliCommandError({ message });

const hasOffset = /(?:z|[+-]\d{2}:?\d{2})$/i;

/** An ISO datetime; without an offset it is wall-clock time in `timeZone`. */
const parseAt = (at: string, timeZone: DateTime.TimeZone): Option.Option<DateTime.Utc> =>
  hasOffset.test(at)
    ? Option.map(DateTime.make(at), DateTime.toUtc)
    : Option.map(DateTime.makeZoned(at, { timeZone, adjustForTimeZone: true }), DateTime.toUtc);

const formatIn = (instant: DateTime.Utc, timeZone: string): string =>
  DateTime.formatIsoZoned(DateTime.makeZonedUnsafe(instant, { timeZone }));

const describeSchedule = (schedule: Schedule): string => {
  const timing = ScheduleTiming.match(schedule.timing, {
    Cron: ({ expression }) => `cron "${expression}" (${schedule.timeZone})`,
    Once: () => "once",
  });

  return `#${schedule.id}  ${timing}  next ${formatIn(schedule.nextRunAt, schedule.timeZone)}  conversation ${schedule.conversationId}\n    ${schedule.prompt}`;
};

/** The first run and timing for exactly one of `--cron` or `--at`. */
const parseTiming = (
  cron: Option.Option<string>,
  at: Option.Option<string>,
  timeZone: DateTime.TimeZone.Named,
  now: DateTime.Utc,
) =>
  Effect.gen(function* () {
    if (Option.isSome(cron) && Option.isNone(at)) {
      yield* Result.match(parseCron(cron.value, timeZone.id), {
        onFailure: (message) => Effect.fail(usageError(`Invalid --cron: ${message}`)),
        onSuccess: () => Effect.void,
      });

      const timing = ScheduleTiming.cases.Cron.make({ expression: cron.value });

      const firstRunAt = yield* Effect.fromOption(nextRun(timing, timeZone.id, now)).pipe(
        Effect.orDie,
      );

      return { timing, firstRunAt };
    }

    if (Option.isSome(at) && Option.isNone(cron)) {
      const runAt = yield* Effect.fromOption(parseAt(at.value, timeZone)).pipe(
        Effect.mapError(() => usageError(`Invalid --at: ${at.value} is not an ISO datetime.`)),
      );

      if (DateTime.isLessThanOrEqualTo(runAt, now)) {
        return yield* usageError(`--at ${at.value} is in the past.`);
      }

      return { timing: ScheduleTiming.cases.Once.make({ runAt }), firstRunAt: runAt };
    }

    return yield* usageError("Pass exactly one of --cron or --at.");
  });

const conversationFlag = Flag.String("conversation").pipe(
  Flag.withSchema(ConversationId),
  Flag.optional,
  Flag.withDescription("The target Conversation (default: OMEN_CONVERSATION_ID)"),
);

/** `omen schedule add | list | remove`. */
export const scheduleCommand = Effect.gen(function* () {
  const omen = yield* Omen;
  const scheduler = yield* Scheduler;

  const add = Command.make(
    "add",
    {
      cron: Flag.String("cron").pipe(
        Flag.optional,
        Flag.withDescription('A recurring time as a cron expression, e.g. "0 9 * * 1-5"'),
      ),
      at: Flag.String("at").pipe(
        Flag.optional,
        Flag.withDescription("A one-off ISO datetime, e.g. 2026-11-21T09:00"),
      ),
      prompt: Flag.String("prompt").pipe(Flag.withDescription("What the agent is asked to do")),
      conversation: conversationFlag,
      timezone: Flag.String("timezone").pipe(
        Flag.optional,
        Flag.withDescription("IANA zone for --cron and --at without an offset (default: local)"),
      ),
    },
    (input) =>
      Effect.gen(function* () {
        const context = yield* CurrentCliContext;

        const conversationId = yield* Effect.fromOption(
          Option.orElse(input.conversation, () => context.conversationId),
        ).pipe(
          Effect.mapError(() =>
            usageError("Pass --conversation <id>; there is no OMEN_CONVERSATION_ID here."),
          ),
        );

        yield* omen
          .conversation(conversationId)
          .pipe(Effect.mapError(() => usageError(`No Conversation ${conversationId}.`)));

        const timeZone = yield* Option.match(input.timezone, {
          onNone: () => Effect.succeed(DateTime.zoneMakeLocal()),
          onSome: (zone) =>
            Effect.fromOption(DateTime.zoneMakeNamed(zone)).pipe(
              Effect.mapError(() => usageError(`Unknown --timezone ${zone}.`)),
            ),
        });

        const now = yield* DateTime.now;
        const { timing, firstRunAt } = yield* parseTiming(input.cron, input.at, timeZone, now);

        const schedule = yield* scheduler.add({
          conversationId,
          timing,
          timeZone: timeZone.id,
          prompt: input.prompt,
          firstRunAt,
        });

        yield* Console.log(
          `Added Schedule #${schedule.id} for Conversation ${conversationId}; next run ${formatIn(schedule.nextRunAt, schedule.timeZone)}.`,
        );
      }),
  ).pipe(Command.withDescription("Schedule a prompt for a Conversation"));

  const list = Command.make(
    "list",
    {
      all: Flag.Boolean("all").pipe(
        Flag.withDefault(false),
        Flag.withDescription("List every Conversation's Schedules"),
      ),
      conversation: conversationFlag,
    },
    ({ all, conversation }) =>
      Effect.gen(function* () {
        const context = yield* CurrentCliContext;
        const target = Option.orElse(conversation, () => context.conversationId);

        const scope = all
          ? Effect.succeedNone
          : Effect.fromOption(target).pipe(
              Effect.asSome,
              Effect.mapError(() =>
                usageError(
                  "Pass --all or --conversation <id>; there is no OMEN_CONVERSATION_ID here.",
                ),
              ),
            );

        const schedules = yield* Effect.flatMap(scope, scheduler.list);

        yield* Console.log(
          schedules.length === 0 ? "No Schedules." : schedules.map(describeSchedule).join("\n"),
        );
      }),
  ).pipe(Command.withDescription("List Schedules, soonest first"));

  const remove = Command.make(
    "remove",
    { id: Argument.Int("id").pipe(Argument.withSchema(ScheduleId)) },
    ({ id }) =>
      Effect.gen(function* () {
        const removed = yield* scheduler.remove(id);

        yield* removed
          ? Console.log(`Removed Schedule #${id}.`)
          : Effect.fail(usageError(`No Schedule #${id}.`));
      }),
  ).pipe(Command.withDescription("Remove a Schedule"));

  return fromCommand(
    Command.make("schedule").pipe(
      Command.withDescription("Manage Schedules"),
      Command.withSubcommands([add, list, remove]),
    ),
    "Schedule prompts for Conversations",
  );
});
