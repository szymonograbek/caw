import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";
import * as Clack from "@clack/prompts";
import type { SetupChoice } from "@omen/sdk/setup";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import { CliFailure } from "../cli-failure.ts";

/** What a spinner shows while its work runs and once it ends. */
export interface SpinnerText<A> {
  readonly running: string;
  readonly done: (result: A) => string;
  readonly failed: string;
}

/** A command and what it does, for the closing next steps. */
export type NextStep = readonly [command: string, purpose: string];

/** A clack prompt; its cancel symbol becomes "Setup cancelled.". */
const prompt = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.promise(run).pipe(
    Effect.filterOrFail(
      (result): result is Exclude<A, symbol> => !Clack.isCancel(result),
      () => new CliFailure({ message: "Setup cancelled." }),
    ),
  );

const commandWidth = (steps: ReadonlyArray<NextStep>) =>
  Math.max(...steps.map(([command]) => command.length));

const prompted = (message: string) =>
  Effect.die(`The wizard prompted "${message}" without a terminal.`);

/**
 * The terminal `omen install` talks through: lines on one guide bar, and
 * prompts that fail with "Setup cancelled." when the person cancels.
 */
export class WizardUi extends Context.Service<
  WizardUi,
  {
    readonly intro: (title: string) => Effect.Effect<void>;
    /** A settled question, shown like an answered prompt: from a flag or a default. */
    readonly answered: (message: string, answer: string) => Effect.Effect<void>;
    /** Lines under the last step. */
    readonly lines: (lines: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly warn: (message: string) => Effect.Effect<void>;
    readonly error: (message: string) => Effect.Effect<void>;
    readonly spin: <A, E, R>(
      text: SpinnerText<A>,
      work: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly select: (
      message: string,
      choices: ReadonlyArray<SetupChoice>,
      initial: string,
    ) => Effect.Effect<string, CliFailure>;
    readonly multiselect: (
      message: string,
      choices: ReadonlyArray<SetupChoice>,
      initial: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<string>, CliFailure>;
    /** Masked input. */
    readonly password: (message: string) => Effect.Effect<string, CliFailure>;
    readonly text: (message: string, initial: string) => Effect.Effect<string, CliFailure>;
    readonly confirm: (message: string, initial: boolean) => Effect.Effect<boolean, CliFailure>;
    readonly outro: (message: string, steps: ReadonlyArray<NextStep>) => Effect.Effect<void>;
  }
>()("@omen/cli/WizardUi") {
  /** clack reading keys from `input` and drawing on `output`. */
  static readonly on = (input: Readable, output: Writable) =>
    Layer.sync(WizardUi, () => {
      const io = { input, output };

      return {
        intro: (title) =>
          Effect.sync(() => Clack.intro(styleText(["bgCyan", "black"], ` ${title} `), io)),
        answered: (message, answer) =>
          Effect.sync(() => Clack.log.step(`${message}\n${styleText("dim", answer)}`, io)),
        lines: (lines) => Effect.sync(() => Clack.log.message([...lines], io)),
        warn: (message) => Effect.sync(() => Clack.log.warn(message, io)),
        error: (message) => Effect.sync(() => Clack.log.error(message, io)),
        spin: (text, work) =>
          Effect.suspend(() => {
            const spinner = Clack.spinner(io);

            spinner.start(text.running);

            return work.pipe(
              Effect.onExit((exit) =>
                Effect.sync(() =>
                  Exit.isSuccess(exit)
                    ? spinner.stop(text.done(exit.value))
                    : Cause.hasInterruptsOnly(exit.cause)
                      ? spinner.cancel()
                      : spinner.error(text.failed),
                ),
              ),
            );
          }),
        select: (message, choices, initial) =>
          prompt((signal) =>
            Clack.select({
              ...io,
              message,
              signal,
              initialValue: initial,
              // clack shows a select's hint only on the focused option, so each label carries its own.
              options: choices.map(({ value, title, hint }) => ({
                value,
                label: hint === undefined ? title : `${title} ${styleText("dim", `(${hint})`)}`,
              })),
            }),
          ),
        multiselect: (message, choices, initial) =>
          prompt((signal) =>
            Clack.multiselect({
              ...io,
              message,
              signal,
              required: false,
              initialValues: initial,
              options: choices.map(({ value, title, hint }) =>
                hint === undefined ? { value, label: title } : { value, label: title, hint },
              ),
            }),
          ),
        password: (message) => prompt((signal) => Clack.password({ ...io, message, signal })),
        text: (message, initial) =>
          prompt((signal) => Clack.text({ ...io, message, signal, initialValue: initial })),
        confirm: (message, initial) =>
          prompt((signal) => Clack.confirm({ ...io, message, signal, initialValue: initial })),
        outro: (message, steps) =>
          Effect.sync(() => {
            Clack.note(
              steps
                .map(
                  ([command, purpose]) =>
                    `${styleText("cyan", command.padEnd(commandWidth(steps)))}  ${purpose}`,
                )
                .join("\n"),
              "Next steps",
              io,
            );
            Clack.outro(styleText("green", message), io);
          }),
      };
    });

  /** clack on this process's terminal. */
  static readonly layer = WizardUi.on(process.stdin, process.stdout);

  /**
   * Appends what the wizard would print to `printed`, as plain text. A prompt
   * is a defect: a test answers every question with a flag.
   */
  static readonly recording = (printed: Array<string>) => {
    const print = (...lines: ReadonlyArray<string>) =>
      Effect.sync(() => {
        printed.push(...lines);
      });

    return Layer.succeed(WizardUi, {
      intro: (title) => print(title),
      answered: (message, answer) => print(`${message}: ${answer}`),
      lines: (lines) => print(...lines),
      warn: (message) => print(message),
      error: (message) => print(message),
      spin: (text, work) =>
        Effect.tap(work, (result) => print(text.done(result))).pipe(
          Effect.tapError(() => print(text.failed)),
        ),
      select: prompted,
      multiselect: prompted,
      password: prompted,
      text: prompted,
      confirm: prompted,
      outro: (message, steps) =>
        print(...steps.map(([command, purpose]) => `${command}  ${purpose}`), message),
    });
  };
}
