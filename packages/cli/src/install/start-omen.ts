import * as NodePath from "node:path";
import { OmenHome } from "@omen/core/omen-home";
import { Data, Effect, FileSystem, Match, Option, Schedule } from "effect";
import { CliFailure } from "../cli-failure.ts";
import { Daemon, pollStatus } from "../daemon.ts";
import { Invocation } from "../invocation.ts";
import { Processes } from "./processes.ts";
import type { ServiceFile } from "./service-file.ts";
import { WizardUi } from "./wizard-ui.ts";

/** How Omen keeps running once the wizard ends. */
export type Launch = Data.TaggedEnum<{
  /** The service manager starts it now and at every login. */
  AtLogin: { readonly service: ServiceFile };
  /** It starts in the background now. `previous` is this platform's service file, removed if present. */
  Now: { readonly previous: Option.Option<ServiceFile> };
}>;

export const Launch = Data.taggedEnum<Launch>();

/** Checks, 100 ms apart, that the service manager released the service. */
const unloadPolls = 100;

/** Polls of `pollStatus`, 100 ms apart, before Omen counts as not starting. */
const startPolls = 300;

/**
 * Starts Omen as `launch` says and waits until it answers. A daemon that
 * already runs is stopped first, so it picks up the settings just written.
 */
export const startOmen = Effect.fn("startOmen")(function* (launch: Launch) {
  const ui = yield* WizardUi;
  const daemon = yield* Daemon;
  const processes = yield* Processes;
  const fs = yield* FileSystem.FileSystem;
  const home = yield* OmenHome;
  const invocation = yield* Invocation;

  /** Waits until the service manager let go of the service, so loading it again works. */
  const unloaded = (service: ServiceFile) =>
    processes.run(service.loaded).pipe(
      Effect.repeat({
        while: ({ code }) => code === 0,
        schedule: Schedule.spaced("100 millis"),
        times: unloadPolls,
      }),
      Effect.filterOrFail(
        ({ code }) => code !== 0,
        () =>
          new CliFailure({
            message: `The service manager still holds Omen; try \`${service.unload.map((command) => command.join(" ")).join(" && ")}\`.`,
          }),
      ),
    );

  /** Exit codes are ignored: unloading a service that is not loaded fails, and that is fine. */
  const unload = (service: ServiceFile) =>
    Effect.forEach(service.unload, processes.run, { discard: true }).pipe(
      Effect.andThen(unloaded(service)),
    );

  const load = (service: ServiceFile) =>
    Effect.forEach(
      service.load,
      (command) =>
        Effect.filterOrFail(
          processes.run(command),
          ({ code }) => code === 0,
          ({ code, output }) =>
            new CliFailure({ message: `\`${command.join(" ")}\` exited with ${code}: ${output}` }),
        ),
      { discard: true },
    );

  /** Stops a daemon that already runs, so the one started next reads the new settings. */
  const stopRunning = daemon.shutdown.pipe(
    Effect.as(true),
    Effect.catchTag("DaemonNotRunning", () => Effect.succeed(false)),
    Effect.flatMap((wasRunning) =>
      wasRunning
        ? ui.spin(
            {
              running: "Stopping the running Omen, so it picks up the new settings",
              done: () => "Stopped the running Omen",
              failed: "Omen did not stop",
            },
            pollStatus(daemon, Option.isNone, 100).pipe(
              Effect.filterOrFail(
                Option.isNone,
                () => new CliFailure({ message: "Omen is still stopping; check `omen status`." }),
              ),
            ),
          )
        : Effect.void,
    ),
  );

  const logs = yield* Match.valueTags(launch, {
    AtLogin: ({ service }) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(NodePath.dirname(service.path), { recursive: true });
        yield* fs.writeFileString(service.path, service.contents);
        yield* ui.lines([`Wrote ${service.path}`]);
        yield* unload(service);
        yield* stopRunning;
        yield* load(service);

        return service.logs;
      }),
    Now: ({ previous }) =>
      Effect.gen(function* () {
        const stale = yield* Effect.filter(Option.toArray(previous), (service) =>
          fs.exists(service.path),
        );

        for (const service of stale) {
          yield* unload(service);
          yield* fs.remove(service.path);
          yield* ui.lines([`Removed ${service.path}, so Omen no longer starts at login`]);
        }

        yield* stopRunning;

        const output = NodePath.join(home.root, "logs", "daemon.out");

        yield* fs.makeDirectory(NodePath.dirname(output), { recursive: true });
        yield* processes.startDetached(
          [...invocation.cli, "start"],
          { OMEN_HOME: home.root },
          output,
        );

        return output;
      }),
  }).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(new CliFailure({ message: `Setting up the service failed: ${error.message}` })),
    ),
  );

  return yield* ui.spin(
    {
      running: "Starting Omen",
      done: (status) => `Omen is running (pid ${status.pid})`,
      failed: "Omen did not start",
    },
    pollStatus(daemon, Option.isSome, startPolls).pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.mapError(
        () =>
          new CliFailure({
            message: `Omen did not answer within 30 seconds. See ${logs} and ${home.logFile}.`,
          }),
      ),
    ),
  );
});
