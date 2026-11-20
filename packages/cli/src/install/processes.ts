import * as Fs from "node:fs";
import { Context, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CliFailure } from "../cli-failure.ts";

/** How a command ended, with its stdout and stderr together. */
export interface Finished {
  readonly code: number;
  readonly output: string;
}

/** The processes `caw install` starts: service-manager commands and the daemon. */
export class Processes extends Context.Service<
  Processes,
  {
    /** Runs `command` to its end. */
    readonly run: (command: ReadonlyArray<string>) => Effect.Effect<Finished, CliFailure>;
    /**
     * Starts `command` on its own, outliving this process, with `env` added to
     * this one's and its output appended to `output`.
     */
    readonly startDetached: (
      command: ReadonlyArray<string>,
      env: Readonly<Record<string, string>>,
      output: string,
    ) => Effect.Effect<void, CliFailure>;
  }
>()("@caw/cli/Processes") {
  static readonly layer = Layer.effect(
    Processes,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      return {
        run: ([program = "", ...args]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(ChildProcess.make(program, args));

              const [output, code] = yield* Effect.all(
                [Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode],
                { concurrency: 2 },
              );

              return { code, output: output.trim() };
            }),
          ).pipe(
            Effect.mapError(
              (error) => new CliFailure({ message: `${program} failed: ${error.message}` }),
            ),
          ),
        startDetached: (command, env, output) =>
          Effect.try({
            try: () => {
              const log = Fs.openSync(output, "a");

              const child = Bun.spawn([...command], {
                env: { ...process.env, ...env },
                stdio: ["ignore", log, log],
                detached: true,
              });

              child.unref();
              Fs.closeSync(log);
            },
            catch: (error) => new CliFailure({ message: `Starting Caw failed: ${String(error)}` }),
          }),
      };
    }),
  );
}
