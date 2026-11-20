#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { OfflineHost } from "@gloaming/core/offline-host";
import { CawHome } from "@gloaming/core/caw-home";
import { Console, Effect, Layer, Logger } from "effect";
import { FetchHttpClient } from "effect/http";
import { CliFailure } from "./cli-failure.ts";
import { Daemon } from "./daemon.ts";
import { forward } from "./forward.ts";
import { Processes } from "./install/processes.ts";
import { WizardUi } from "./install/wizard-ui.ts";
import { Invocation } from "./invocation.ts";
import { runsLocally } from "./routing.ts";

const argv = process.argv.slice(2);

const services = Layer.mergeAll(
  Invocation.layer,
  Daemon.layer.pipe(Layer.provideMerge(CawHome.layer)),
  Logger.layer([Logger.consolePretty()]),
  Layer.succeed(Logger.LogToStderr, true),
).pipe(Layer.provideMerge(Layer.merge(BunServices.layer, FetchHttpClient.layer)));

/** `CliFailure` messages go to stderr; the runtime turns the failure into exit code 1. */
const reportFailure = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.tapError(program, (error) =>
    error instanceof CliFailure ? Console.error(error.message) : Effect.void,
  );

// Only daemon-less commands open the store, so forwarding stays light for the agent's shell.
if (runsLocally(argv)) {
  // Loaded only here: the built-in Plugins' modules take a while to import.
  reportFailure(
    Effect.flatMap(
      Effect.promise(() => import("./cli.ts")),
      ({ runLocal }) => runLocal(argv),
    ),
  ).pipe(
    Effect.provide(
      Layer.mergeAll(OfflineHost.standalone, WizardUi.layer, Processes.layer).pipe(
        Layer.provideMerge(services),
      ),
    ),
    BunRuntime.runMain,
  );
} else {
  reportFailure(forward(argv)).pipe(Effect.provide(services), BunRuntime.runMain);
}
