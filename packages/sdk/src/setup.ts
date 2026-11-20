import type { Option } from "effect";
import { Data, Effect, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { HarnessName } from "./ids.ts";

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
    readonly choices: ReadonlyArray<{ readonly value: string; readonly title: string }>;
    /** The `value` taken by default. */
    readonly initial: string;
  };
  Text: {
    readonly key: string;
    readonly flag: string;
    readonly message: string;
    readonly initial: string;
  };
}>;

export const SetupQuestion = Data.taggedEnum<SetupQuestion>();

/** Answers by question `key`; every question the Plugin asked has one. */
export type SetupAnswers = ReadonlyMap<string, string>;

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
}

/**
 * A Plugin's part in `omen install`. A Plugin without one is a feature: the
 * wizard only asks whether to enable it.
 */
export type PluginSetup = Data.TaggedEnum<{
  Channel: {
    /** The name people pick from, e.g. `Discord`. */
    readonly title: string;
    readonly questions: ReadonlyArray<SetupQuestion>;
    readonly configure: (
      answers: SetupAnswers,
    ) => Effect.Effect<ChannelConfigured, SetupError, HttpClient.HttpClient>;
  };
  Harness: {
    readonly title: string;
    readonly questions: ReadonlyArray<SetupQuestion>;
    readonly configure: (answers: SetupAnswers) => Effect.Effect<HarnessConfigured, SetupError>;
  };
}>;

export const PluginSetup = Data.taggedEnum<PluginSetup>();

/** The answer to the question with `key`. */
export const answer = (answers: SetupAnswers, key: string): Effect.Effect<string, SetupError> => {
  const value = answers.get(key);

  return value === undefined
    ? Effect.fail(new SetupError({ message: `No answer for ${key}.` }))
    : Effect.succeed(value);
};
