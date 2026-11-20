import type { SetupAnswers, SetupError, SetupQuestion } from "@omen/sdk/setup";
import { SetupQuestion as Question } from "@omen/sdk/setup";
import { Console, Effect, FileSystem, Match, Option, Redacted } from "effect";
import { Prompt } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";

/**
 * How the wizard settles a question no flag answered: `yes` takes the
 * default (and fails where there is none), otherwise it prompts.
 */
export interface Asking {
  readonly yes: boolean;
}

/** Values of the flags generated from Plugins' setup questions, by flag name. */
export type QuestionFlags = Readonly<Record<string, Option.Option<string>>>;

/** A Secret is read from a file, so the value stays out of shell history and `ps`. */
export const flagNameOf = (question: SetupQuestion): string =>
  Question.$is("Secret")(question) ? `${question.flag}-file` : question.flag;

const cancelled = Effect.mapError(() => new CliFailure({ message: "Setup cancelled." }));

/** `given`, else the default under `--yes`, else the prompt's answer. */
export const ask = <A>(
  asking: Asking,
  given: Option.Option<A>,
  fallback: Option.Option<A>,
  missing: string,
  prompt: Prompt.Prompt<A>,
) =>
  Option.match(given, {
    onSome: Effect.succeed,
    onNone: () =>
      asking.yes
        ? Effect.fromOption(fallback).pipe(
            Effect.mapError(() => new CliFailure({ message: missing })),
          )
        : prompt.pipe(cancelled),
  });

const answerQuestion = (asking: Asking, flags: QuestionFlags, question: SetupQuestion) => {
  const given = Option.flatten(Option.fromNullishOr(flags[flagNameOf(question)]));
  const missing = `Pass --${flagNameOf(question)}.`;

  return Match.valueTags(question, {
    Secret: ({ message }) =>
      Option.match(given, {
        onSome: (path) =>
          FileSystem.FileSystem.use((fs) => fs.readFileString(path)).pipe(
            Effect.map((text) => text.trim()),
            Effect.mapError(
              (error) => new CliFailure({ message: `Reading ${path} failed: ${error.message}` }),
            ),
          ),
        onNone: () =>
          ask(asking, Option.none(), Option.none(), missing, Prompt.Password({ message })).pipe(
            Effect.map(Redacted.value),
          ),
      }),
    Choice: ({ message, choices, initial, flag }) =>
      Effect.filterOrFail(
        ask(
          asking,
          given,
          Option.some(initial),
          missing,
          Prompt.Select({
            message,
            choices: choices.map(({ value, title }) => ({
              title,
              value,
              selected: value === initial,
            })),
          }),
        ),
        (value) => choices.some((choice) => choice.value === value),
        () =>
          new CliFailure({
            message: `--${flag} must be one of ${choices.map((choice) => choice.value).join(", ")}.`,
          }),
      ),
    Text: ({ message, initial }) =>
      ask(
        asking,
        given,
        Option.some(initial),
        missing,
        Prompt.String({ message, default: initial }),
      ),
  }).pipe(Effect.map((value) => [question.key, value] as const));
};

/**
 * Answers a Plugin's questions and runs its `configure`. When every answer was
 * typed in, a rejected answer is shown and the questions are asked again.
 */
export const configureWith = <A, R>(
  asking: Asking,
  flags: QuestionFlags,
  questions: ReadonlyArray<SetupQuestion>,
  configure: (answers: SetupAnswers) => Effect.Effect<A, SetupError, R>,
) => {
  const interactive =
    !asking.yes &&
    questions.every((question) =>
      Option.isNone(Option.flatten(Option.fromNullishOr(flags[flagNameOf(question)]))),
    );

  const attempt = (): Effect.Effect<A, CliFailure, R | Prompt.Environment> =>
    Effect.forEach(questions, (question) => answerQuestion(asking, flags, question)).pipe(
      Effect.flatMap((answers) => configure(new Map(answers))),
      Effect.catchTag("SetupError", ({ message }) =>
        interactive
          ? Effect.andThen(Console.error(message), Effect.suspend(attempt))
          : Effect.fail(new CliFailure({ message })),
      ),
    );

  return attempt();
};
