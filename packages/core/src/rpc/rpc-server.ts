import { BunSocketServer } from "@effect/platform-bun";
import { CliCommandError } from "@gloaming/sdk/plugin";
import { Effect, Layer, Option } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { conversationCommand } from "../commands/conversation-command.ts";
import { pluginCommand } from "../commands/plugin-command.ts";
import { HostFiles } from "../home/host-files.ts";
import { CawHome } from "../home/caw-home.ts";
import { PluginHost } from "../plugins/plugin-host.ts";
import { Registry } from "../plugins/registry.ts";
import { SessionPool } from "../sessions/session-pool.ts";
import { DaemonLifecycle } from "./daemon-lifecycle.ts";
import { DaemonStatus, CawRpcs, PluginStatus } from "./caw-rpcs.ts";

const handlers = CawRpcs.toLayer(
  Effect.gen(function* () {
    const lifecycle = yield* DaemonLifecycle;
    const plugins = yield* PluginHost;
    const pool = yield* SessionPool;
    const registry = yield* Registry;
    const coreCommands = [yield* pluginCommand, yield* conversationCommand];

    return CawRpcs.of({
      Status: () =>
        Effect.gen(function* () {
          const entries = yield* plugins.list;
          const live = yield* pool.live;

          return new DaemonStatus({
            pid: lifecycle.pid,
            startedAt: lifecycle.startedAt,
            plugins: entries.map(
              ({ row, state }) =>
                new PluginStatus({
                  name: row.name,
                  source: row.source,
                  version: row.version,
                  state,
                }),
            ),
            liveSessions: live.length,
          });
        }),
      Shutdown: () => lifecycle.shutdown,
      RunCommand: ({ argv, conversationId, cwd }) =>
        Effect.gen(function* () {
          // The socket opens before Plugins start; their commands exist only once they have.
          yield* lifecycle.ready;
          const [name, ...args] = argv;
          const core = Option.fromNullishOr(coreCommands.find((command) => command.name === name));

          const command =
            name === undefined || Option.isSome(core) ? core : yield* registry.cliCommand(name);

          if (Option.isNone(command)) {
            return yield* new CliCommandError({ message: `Unknown command: ${name ?? ""}` });
          }

          return yield* command.value.run(args, { conversationId, cwd });
        }),
    });
  }),
);

/** Serves `CawRpcs` on `<home>/caw.sock`, replacing a socket file a crashed daemon left. */
export const rpcServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const home = yield* CawHome;
    const files = yield* HostFiles;

    yield* files.remove(home.socket).pipe(Effect.orDie);

    const protocol = RpcServer.layerProtocolSocketServer.pipe(
      Layer.provide([
        // SAFETY: `@effect/platform-bun` is an allowed unstable API; its socket layers
        // re-export `@effect/platform-node-shared`, which the check attributes separately.
        // @effect-diagnostics-next-line unstableApiUsage:off
        Layer.orDie(BunSocketServer.layer({ path: home.socket })),
        RpcSerialization.layerNdjson,
      ]),
    );

    return RpcServer.layer(CawRpcs).pipe(Layer.provide([handlers, protocol]));
  }),
);
