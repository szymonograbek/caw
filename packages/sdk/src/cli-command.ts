import {
  Console,
  Context,
  Effect,
  FileSystem,
  Formatter,
  Layer,
  Path,
  Predicate,
  Stdio,
  Terminal,
} from "effect";
import type { CliError, Command } from "effect/cli";
import { CliConfig, CliOutput, GlobalFlag, Command as Cli } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";
import type { CliCommand, CliContext } from "./plugin.ts";
import { CliCommandError } from "./plugin.ts";

/** The `CliContext` of the invocation a command handler runs in. */
export class CurrentCliContext extends Context.Service<CurrentCliContext, CliContext>()(
  "@gloaming/caw-plugin-sdk/CurrentCliContext",
) {}

/**
 * Runs inside the daemon, so nothing may touch the host terminal, process or
 * files on the CLI's behalf. Only `--help` stays as a built-in flag.
 */
const daemonEnvironment = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(100),
      rows: Effect.succeed(40),
      size: Effect.die("A daemon CLI command has no terminal"),
      readInput: Effect.die("A daemon CLI command has no terminal"),
      readLine: Effect.die("A daemon CLI command has no terminal"),
      display: () => Effect.die("A daemon CLI command has no terminal"),
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("A daemon CLI command cannot spawn processes")),
  ),
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  CliConfig.layer({ builtIns: [GlobalFlag.Help] }),
);

const formatLine = (parts: ReadonlyArray<unknown>): string =>
  parts.map((part) => (Predicate.isString(part) ? part : Formatter.format(part))).join(" ");

const ignore = (): void => {};

/** A `Console` that keeps every printed line, stdout and stderr interleaved, in order. */
const makeBufferedConsole = () => {
  const lines: Array<string> = [];

  const record = (...parts: ReadonlyArray<unknown>): void => {
    lines.push(formatLine(parts));
  };

  const console: Console.Console = {
    assert: ignore,
    clear: ignore,
    count: ignore,
    countReset: ignore,
    debug: record,
    dir: record,
    dirxml: record,
    error: record,
    group: ignore,
    groupCollapsed: ignore,
    groupEnd: ignore,
    info: record,
    log: record,
    table: record,
    time: ignore,
    timeEnd: ignore,
    timeLog: ignore,
    trace: record,
    warn: record,
  };

  return { console, text: () => lines.join("\n") };
};

/**
 * Turns an `effect/cli` command into a `CliCommand`. `run` parses `args`
 * (everything after `caw <name>`) and returns everything the command printed:
 * help, usage errors and handler output. Handlers print with `Console`, read
 * the invocation through `CurrentCliContext`, and report domain failures as
 * `CliCommandError`. Usage errors fail with the help and errors as the message.
 */
export const fromCommand = <Name extends string, Input, ContextInput>(
  command: Command.Command<Name, Input, ContextInput, CliCommandError, CurrentCliContext>,
  summary: string,
): CliCommand => ({
  name: command.name,
  summary,
  run: (args, context) =>
    Effect.suspend(() => {
      const buffer = makeBufferedConsole();

      // Help and usage errors are already in the output; other errors add their message.
      const toCommandError = (error: CliCommandError | CliError.CliError) =>
        new CliCommandError({
          message: [buffer.text(), Predicate.isTagged(error, "ShowHelp") ? "" : error.message]
            .filter((part) => part.length > 0)
            .join("\n"),
        });

      return Cli.runWith(command, { version: "0.0.0" })(args).pipe(
        Effect.map(() => buffer.text()),
        // Without errors, help was shown for a command group that has no handler of its own.
        Effect.catchTag("ShowHelp", (error) =>
          error.errors.length === 0 ? Effect.succeed(buffer.text()) : Effect.fail(error),
        ),
        Effect.mapError(toCommandError),
        Effect.provideService(CurrentCliContext, context),
        Effect.provideService(Console.Console, buffer.console),
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- SAFETY: each run is the entry point of a self-contained `effect/cli` program; the layer is pure stubs.
        Effect.provide(daemonEnvironment),
      );
    }),
});
