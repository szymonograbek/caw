import type { SetupAnswers, SetupChoice, SetupError, SetupQuestion } from "@gloaming/sdk/setup";
import { SetupAnswer, SetupQuestion as Question } from "@gloaming/sdk/setup";
import { Effect, FileSystem, Match, Option } from "effect";
import { CliFailure } from "../cli-failure.ts";
import { WizardUi } from "./wizard-ui.ts";

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

/** One question the wizard settles. */
interface Step<A> {
  readonly message: string;
  /** From a flag. */
  readonly given: Option.Option<A>;
  /** Taken under `--yes`. */
  readonly fallback: Option.Option<A>;
  /** The failure under `--yes` with no fallback. */
  readonly missing: string;
  /** The answer as shown when it came from a flag or the fallback. */
  readonly describe: (answer: A) => string;
  readonly prompt: Effect.Effect<A, CliFailure>;
}

/**
 * `given`, else the fallback under `--yes`, else the prompt's answer. An
 * answer that was not typed in is shown like an answered prompt.
 */
export const ask = <A>(asking: Asking, step: Step<A>) =>
  Effect.gen(function* () {
    const ui = yield* WizardUi;

    const settled = Option.isSome(step.given)
      ? step.given
      : asking.yes
        ? step.fallback
        : Option.none();

    if (Option.isSome(settled)) {
      yield* ui.answered(step.message, step.describe(settled.value));

      return settled.value;
    }

    return asking.yes ? yield* new CliFailure({ message: step.missing }) : yield* step.prompt;
  });

/** Comma-separated names, as list flags take them. */
export const splitNames = (text: string): ReadonlyArray<string> =>
  text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

const titlesOf = (choices: ReadonlyArray<SetupChoice>, values: ReadonlyArray<string>): string =>
  choices.flatMap((choice) => (values.includes(choice.value) ? [choice.title] : [])).join(", ") ||
  "none";

const one = <E, R>(answer: Effect.Effect<string, E, R>) =>
  Effect.map(answer, (value) => SetupAnswer.One({ value }));

const givenFor = (flags: QuestionFlags, question: SetupQuestion) =>
  Option.flatten(Option.fromNullishOr(flags[flagNameOf(question)]));

/** A Secret from the file `given` names, else typed in masked. */
const answerSecret = (
  asking: Asking,
  given: Option.Option<string>,
  message: string,
  missing: string,
): Effect.Effect<string, CliFailure, FileSystem.FileSystem | WizardUi> =>
  Effect.gen(function* () {
    const ui = yield* WizardUi;

    if (Option.isNone(given)) {
      return yield* ask(asking, {
        message,
        given: Option.none(),
        fallback: Option.none(),
        missing,
        describe: () => "",
        prompt: ui.password(message),
      });
    }

    const path = given.value;

    const text = yield* FileSystem.FileSystem.use((fs) => fs.readFileString(path)).pipe(
      Effect.mapError(
        (error) => new CliFailure({ message: `Reading ${path} failed: ${error.message}` }),
      ),
    );

    yield* ui.answered(message, `read from ${path}`);

    return text.trim();
  });

const answerQuestion = (asking: Asking, flags: QuestionFlags, question: SetupQuestion) =>
  Effect.gen(function* () {
    const ui = yield* WizardUi;
    const given = givenFor(flags, question);
    const missing = `Pass --${flagNameOf(question)}.`;

    const answer = yield* Match.valueTags(question, {
      Secret: ({ message }) => one(answerSecret(asking, given, message, missing)),
      Choice: ({ message, choices, initial, flag }) =>
        Effect.filterOrFail(
          ask(asking, {
            message,
            given,
            fallback: Option.some(initial),
            missing,
            describe: (value) => titlesOf(choices, [value]),
            prompt: ui.select(message, choices, initial),
          }),
          (value) => choices.some((choice) => choice.value === value),
          () =>
            new CliFailure({
              message: `--${flag} must be one of ${choices.map((choice) => choice.value).join(", ")}.`,
            }),
        ).pipe(one),
      MultiChoice: ({ message, choices, initial }) =>
        ask(asking, {
          message,
          given: Option.map(given, splitNames),
          fallback: Option.some(initial),
          missing,
          describe: (values) => titlesOf(choices, values),
          prompt: ui.multiselect(message, choices, initial),
        }).pipe(Effect.map((values) => SetupAnswer.Many({ values }))),
      Text: ({ message, initial }) =>
        ask(asking, {
          message,
          given,
          fallback: Option.some(initial),
          missing,
          describe: (value) => value,
          prompt: ui.text(message, initial),
        }).pipe(one),
    });

    return [question.key, answer] as const;
  });

/** The part of a Plugin's setup the wizard runs. */
interface Configurable<A, R> {
  readonly title: string;
  readonly questions: ReadonlyArray<SetupQuestion>;
  readonly configure: (answers: SetupAnswers) => Effect.Effect<A, SetupError, R>;
}

/**
 * Answers a Plugin's questions and runs its `configure` under a spinner. When
 * every answer was typed in, a rejected answer is shown and the questions are
 * asked again.
 */
export const configureWith = <A, R>(
  asking: Asking,
  flags: QuestionFlags,
  setup: Configurable<A, R>,
) =>
  Effect.gen(function* () {
    const ui = yield* WizardUi;

    const interactive =
      !asking.yes && setup.questions.every((question) => Option.isNone(givenFor(flags, question)));

    const attempt = (): Effect.Effect<A, CliFailure, R | WizardUi | FileSystem.FileSystem> =>
      Effect.forEach(setup.questions, (question) => answerQuestion(asking, flags, question)).pipe(
        Effect.flatMap((answers) =>
          ui.spin(
            {
              running: `Checking the ${setup.title} settings`,
              done: () => `${setup.title} settings checked`,
              failed: `${setup.title} settings rejected`,
            },
            setup.configure(new Map(answers)),
          ),
        ),
        Effect.catchTag("SetupError", ({ message }) =>
          interactive
            ? Effect.andThen(ui.error(message), Effect.suspend(attempt))
            : Effect.fail(new CliFailure({ message })),
        ),
      );

    return yield* attempt();
  });
