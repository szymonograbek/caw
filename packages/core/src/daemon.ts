import { CawEvent } from "@caw/sdk/events";
import { Effect, Layer } from "effect";
import { EventBus } from "./events/event-bus.ts";
import { writeAgentFiles } from "./home/agent-files.ts";
import { hostCoreLayer } from "./host-core-layer.ts";
import { daemonLoggerLayer } from "./logging/daemon-logger.ts";
import type { LoadedPlugin } from "./plugins/loaded-plugin.ts";
import { PluginHost } from "./plugins/plugin-host.ts";
import { DaemonLifecycle } from "./rpc/daemon-lifecycle.ts";
import { rpcServerLayer } from "./rpc/rpc-server.ts";
import { Sessions } from "./store/sessions.ts";

export interface DaemonOptions {
  /** The Plugins that ship with Caw, enabled on first start. */
  readonly builtins: ReadonlyArray<LoadedPlugin>;
  /** The command that starts this CLI (`[bun, main.ts]`, or the compiled binary); Sessions run it through `<home>/bin/caw`. */
  readonly cli: ReadonlyArray<string>;
}

/** Starts every enabled Plugin, then serves until `Shutdown` (or interruption). */
const serve = Effect.fn("Daemon.serve")(function* (options: DaemonOptions) {
  const sessions = yield* Sessions;
  const plugins = yield* PluginHost;
  const bus = yield* EventBus;
  const lifecycle = yield* DaemonLifecycle;

  yield* writeAgentFiles(options.cli).pipe(Effect.orDie);
  yield* sessions.idleAllLive;
  yield* plugins.start(options.builtins);
  yield* lifecycle.markReady;
  yield* bus.publish(CawEvent.DaemonStarted());
  yield* Effect.logInfo("Caw started").pipe(Effect.annotateLogs({ pid: lifecycle.pid }));
  yield* lifecycle.stopped;
  yield* bus.publish(CawEvent.DaemonStopping());
  yield* Effect.logInfo("Caw stopping");
});

const daemonLayer = Layer.mergeAll(rpcServerLayer, daemonLoggerLayer).pipe(
  Layer.provideMerge(Layer.merge(hostCoreLayer, DaemonLifecycle.layer)),
);

/**
 * The daemon `caw start` runs in the foreground: core services, the RPC
 * socket and JSON file logging, all under `CAW_HOME`.
 */
export const runDaemon = (options: DaemonOptions) =>
  // This is the daemon's entry point: every layer is provided once, here.
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  serve(options).pipe(Effect.provide(daemonLayer));
