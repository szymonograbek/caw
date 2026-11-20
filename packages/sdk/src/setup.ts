import { Data, Effect, Option, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { HarnessName } from "./ids.ts";

/** One option of a `Choice` or `MultiChoice` question. */
export interface SetupChoice {
  readonly value: string;
  readonly title: string;
  /** A few words shown beside the title. */
  readonly hint?: string | undefined;
}

/**
 * One answer `omen install` collects for a Plugin. It is prompted for, or read
 * from `--<flag>` so the wizard also runs without a terminal. `flag` must be
 * unique across Plugins, so prefix it with the Plugin's name when it is not
 * obviously the Plugin's own.
 */
export type SetupQuestion = Data.TaggedEnum<{
  /** Hidden input. Non-interactively it is read from the file `--<flag>-file <path>` names. */
  Secret: { readonly key: string; readonly flag: string; readonly message: string };
  Choice: {
    readonly key: string;
    readonly flag: string;
    readonly message: string;
    readonly choices: ReadonlyArray<SetupChoice>;
    /** The `value` taken by default. */
    readonly initial: string;
  };
  /** Any number of `choices`; `--<flag>` takes them comma-separated. The answer is a list. */
  MultiChoice: {
    readonly key: string;
    readonly flag: string;
    readonly message: string;
    readonly choices: ReadonlyArray<SetupChoice>;
    /** The `value`s taken by default. */
    readonly initial: ReadonlyArray<string>;
  };
  Text: {
    readonly key: string;
    readonly flag: string;
    readonly message: string;
    readonly initial: string;
  };
}>;

export const SetupQuestion = Data.taggedEnum<SetupQuestion>();

/** A `MultiChoice` question's answer is `Many`; every other answer is `One`. */
export type SetupAnswer = Data.TaggedEnum<{
  One: { readonly value: string };
  Many: { readonly values: ReadonlyArray<string> };
}>;

export const SetupAnswer = Data.taggedEnum<SetupAnswer>();

/** Answers by question `key`; every question the Plugin asked has one. */
export type SetupAnswers = ReadonlyMap<string, SetupAnswer>;

/** The answers do not work (a rejected token, an unknown option). The wizard shows `message`. */
export class SetupError extends Schema.TaggedError<SetupError, { readonly brand: unique symbol }>()(
  "SetupError",
  { message: Schema.String },
) {}

/** A Channel's checked config. */
export interface ChannelConfigured {
  /** Lines the wizard prints, e.g. the bot's name and servers. */
  readonly report: ReadonlyArray<string>;
  /** Written into `<home>/.env`, keeping its other entries. */
  readonly env: Readonly<Record<string, string>>;
}

/** A Harness's chosen options; they become the `default` Harness profile. */
export interface HarnessConfigured {
  readonly report: ReadonlyArray<string>;
  readonly harness: HarnessName;
  readonly model: Option.Option<string>;
  readonly settingSources: Option.Option<ReadonlyArray<string>>;
  /**
   * The installing shell's variables the Harness needs. The daemon does not run
   * in that shell, so they are saved in the profile.
   */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * A Plugin's part in `omen install`. A Plugin without one is a feature: the
 * wizard only asks whether to enable it.
 */
export type PluginSetup = Data.TaggedEnum<{
  Channel: {
    /** The name people pick from, e.g. `Discord`. */
    readonly title: string;
    /** A few words shown beside the title, e.g. `Discord bot`. */
    readonly hint?: string;
    readonly questions: ReadonlyArray<SetupQuestion>;
    readonly configure: (
      answers: SetupAnswers,
    ) => Effect.Effect<ChannelConfigured, SetupError, HttpClient.HttpClient>;
  };
  Harness: {
    readonly title: string;
    readonly hint?: string;
    readonly questions: ReadonlyArray<SetupQuestion>;
    readonly configure: (answers: SetupAnswers) => Effect.Effect<HarnessConfigured, SetupError>;
  };
}>;

export const PluginSetup = Data.taggedEnum<PluginSetup>();

const missing = (key: string) => new SetupError({ message: `No answer for ${key}.` });

/** The answer to the single-answer question with `key`. */
export const answer = (answers: SetupAnswers, key: string): Effect.Effect<string, SetupError> =>
  Option.fromNullishOr(answers.get(key)).pipe(
    Option.filter(SetupAnswer.$is("One")),
    Option.map(({ value }) => value),
    Effect.fromOption,
    Effect.mapError(() => missing(key)),
  );

/** The answer to the `MultiChoice` question with `key`. */
export const answerList = (
  answers: SetupAnswers,
  key: string,
): Effect.Effect<ReadonlyArray<string>, SetupError> =>
  Option.fromNullishOr(answers.get(key)).pipe(
    Option.filter(SetupAnswer.$is("Many")),
    Option.map(({ values }) => values),
    Effect.fromOption,
    Effect.mapError(() => missing(key)),
  );
