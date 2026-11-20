import { OmenEvent } from "@omen/sdk/events";
import { Effect, Layer } from "effect";
import { EventBus } from "./events/event-bus.ts";
import { writeCliShim } from "./home/cli-shim.ts";
import { hostCoreLayer } from "./host-core-layer.ts";
import { daemonLoggerLayer } from "./logging/daemon-logger.ts";
import type { LoadedPlugin } from "./plugins/loaded-plugin.ts";
import { PluginHost } from "./plugins/plugin-host.ts";
import { DaemonLifecycle } from "./rpc/daemon-lifecycle.ts";
import { rpcServerLayer } from "./rpc/rpc-server.ts";
import { Sessions } from "./store/sessions.ts";

export interface DaemonOptions {
  /** The Plugins that ship with Omen, enabled on first start. */
  readonly builtins: ReadonlyArray<LoadedPlugin>;
  /** The CLI's main module; Sessions run it through `<home>/bin/omen`. */
  readonly cliEntry: string;
}

/** Starts every enabled Plugin, then serves until `Shutdown` (or interruption). */
const serve = Effect.fn("Daemon.serve")(function* (options: DaemonOptions) {
  const sessions = yield* Sessions;
  const plugins = yield* PluginHost;
  const bus = yield* EventBus;
  const lifecycle = yield* DaemonLifecycle;

  yield* writeCliShim(options.cliEntry).pipe(Effect.orDie);
  yield* sessions.idleAllLive;
  yield* plugins.start(options.builtins);
  yield* bus.publish(OmenEvent.DaemonStarted());
  yield* Effect.logInfo("Omen started").pipe(Effect.annotateLogs({ pid: lifecycle.pid }));
  yield* lifecycle.stopped;
  yield* bus.publish(OmenEvent.DaemonStopping());
  yield* Effect.logInfo("Omen stopping");
});

const daemonLayer = Layer.mergeAll(rpcServerLayer, daemonLoggerLayer).pipe(
  Layer.provideMerge(Layer.merge(hostCoreLayer, DaemonLifecycle.layer)),
);

/**
 * The daemon `omen start` runs in the foreground: core services, the RPC
 * socket and JSON file logging, all under `OMEN_HOME`.
 */
export const runDaemon = (options: DaemonOptions) =>
  // This is the daemon's entry point: every layer is provided once, here.
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  serve(options).pipe(Effect.provide(daemonLayer));
