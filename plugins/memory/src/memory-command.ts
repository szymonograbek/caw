import { Console, Effect, Option, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { fromCommand } from "@caw/sdk/cli-command";
import { CliCommandError } from "@caw/sdk/plugin";
import { exportMarkdown } from "./memory-export.ts";
import { MemoryStore } from "./memory-store.ts";

/** The daemon writes the file, so a relative path would land in the daemon's own cwd. */
const AbsolutePath = Schema.String.check(
  Schema.isPattern(/^\//, { message: "--out must be an absolute path" }),
);

const writeFile = (path: string, text: string) =>
  Effect.tryPromise({
    try: () => Bun.write(path, text),
    catch: (cause) => new CliCommandError({ message: `Could not write ${path}: ${String(cause)}` }),
  });

/** `caw memory export [--out <file>]`. */
export const memoryCommand = Effect.gen(function* () {
  const store = yield* MemoryStore;

  const exportCommand = Command.make(
    "export",
    {
      out: Flag.String("out").pipe(
        Flag.withSchema(AbsolutePath),
        Flag.optional,
        Flag.withDescription("Write the markdown to this absolute path instead of printing it"),
      ),
    },
    ({ out }) =>
      Effect.gen(function* () {
        const memories = yield* store.all;
        const markdown = exportMarkdown(memories);

        yield* Option.match(out, {
          onNone: () => Console.log(markdown),
          onSome: (path) =>
            writeFile(path, `${markdown}\n`).pipe(
              Effect.andThen(Console.log(`Exported ${memories.length} Memories to ${path}.`)),
            ),
        });
      }),
  ).pipe(Command.withDescription("Export every Memory as markdown"));

  return fromCommand(
    Command.make("memory").pipe(
      Command.withDescription("Inspect Memories"),
      Command.withSubcommands([exportCommand]),
    ),
    "Export Memories as markdown",
  );
});
