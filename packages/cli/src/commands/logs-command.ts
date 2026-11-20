import { OmenHome } from "@omen/core/omen-home";
import { Effect, FileSystem, Ref, Schedule, Stdio, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";

export const logsCommand = Command.make(
  "logs",
  {
    follow: Flag.Boolean("follow").pipe(
      Flag.withAlias("f"),
      Flag.withDefault(false),
      Flag.withDescription("Keep printing new lines as the daemon writes them"),
    ),
  },
  ({ follow }) =>
    Effect.gen(function* () {
      const home = yield* OmenHome;
      const fs = yield* FileSystem.FileSystem;
      const stdio = yield* Stdio.Stdio;

      if (!(yield* fs.exists(home.logFile))) {
        return yield* new CliFailure({ message: `No log yet at ${home.logFile}.` });
      }

      /** Prints the bytes after `offset` and returns the new end of the file. */
      const printFrom = (offset: bigint) =>
        Effect.gen(function* () {
          const size = (yield* fs.stat(home.logFile)).size;

          // A log shorter than before was replaced, so it is read from its start.
          const from = size < offset ? 0n : offset;

          yield* fs
            .stream(home.logFile, { offset: from, bytesToRead: size - from })
            .pipe(Stream.run(stdio.stdout()));

          return size;
        });

      const printedUpTo = yield* printFrom(0n);
      const printed = yield* Ref.make(printedUpTo);

      const printNew = Ref.get(printed).pipe(
        Effect.flatMap(printFrom),
        Effect.flatMap((end) => Ref.set(printed, end)),
      );

      return yield* follow ? Effect.repeat(printNew, Schedule.spaced("500 millis")) : Effect.void;
    }).pipe(
      Effect.catchTag("PlatformError", (error) =>
        Effect.fail(new CliFailure({ message: `Reading the log failed: ${error.message}` })),
      ),
    ),
).pipe(Command.withDescription(`Print the daemon's JSON log, or follow it with -f`));
