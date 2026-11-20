import { createWriteStream } from "node:fs";
import * as NodePath from "node:path";
import { Effect, Layer, Logger } from "effect";
import { HostFiles } from "../home/host-files.ts";
import { CawHome } from "../home/caw-home.ts";

/** Appends one JSON object per log line to the daemon's log file. */
const jsonFileLogger = Effect.gen(function* () {
  const home = yield* CawHome;
  const files = yield* HostFiles;

  yield* files.ensureDirectory(NodePath.dirname(home.logFile)).pipe(Effect.orDie);

  const stream = yield* Effect.acquireRelease(
    Effect.sync(() => createWriteStream(home.logFile, { flags: "a" })),
    (opened) =>
      Effect.callback<void>((resume) => {
        opened.end(() => resume(Effect.void));
      }),
  );

  return Logger.map(Logger.formatJson, (line) => {
    stream.write(`${line}\n`);
  });
});

/** Structured JSON in `<home>/logs/caw.log`, plus pretty lines on stderr for a foreground daemon. */
export const daemonLoggerLayer = Layer.mergeAll(
  Logger.layer([jsonFileLogger, Logger.consolePretty()]),
  Layer.succeed(Logger.LogToStderr, true),
);
