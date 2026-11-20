import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Option } from "effect";
import { CawHome } from "../home/caw-home.ts";
import { makeFakeChannel } from "../testing/fake-channel.ts";
import { makeFakeHarness } from "../testing/fake-harness.ts";
import { startPlugins, temporaryHome, testCoreLayer } from "../testing/test-daemon.ts";
import { DaemonLifecycle } from "./daemon-lifecycle.ts";
import { CawClient } from "./rpc-client.ts";
import { rpcServerLayer } from "./rpc-server.ts";

const server = Layer.unwrap(
  Effect.map(temporaryHome, (home) =>
    rpcServerLayer.pipe(
      Layer.provideMerge(Layer.merge(testCoreLayer(home), DaemonLifecycle.layer)),
    ),
  ),
);

describe("RPC over the daemon socket", () => {
  it.live("answers Status and RunCommand through a real unix socket", () =>
    Effect.gen(function* () {
      const channel = yield* makeFakeChannel;
      const harness = yield* makeFakeHarness;

      yield* startPlugins(channel, harness);
      yield* DaemonLifecycle.use((daemon) => daemon.markReady);

      const home = yield* CawHome;
      const lifecycle = yield* DaemonLifecycle;

      const { status, unknown } = yield* Effect.gen(function* () {
        const client = yield* CawClient;

        return {
          status: yield* client.Status(),
          unknown: yield* Effect.exit(
            client.RunCommand({ argv: ["nope"], conversationId: Option.none(), cwd: "/" }),
          ),
        };
      }).pipe(Effect.provide(CawClient.layer(home.socket)));

      expect(status.pid).toBe(lifecycle.pid);
      expect(status.liveSessions).toBe(0);
      expect(status.plugins.map((plugin) => [plugin.name, plugin.state._tag])).toEqual([
        ["fake", "Running"],
      ]);

      expect(unknown).toEqual(
        Exit.fail(expect.objectContaining({ message: "Unknown command: nope" })),
      );
    }).pipe(Effect.provide(server), Effect.scoped),
  );

  it.live("holds a command sent while Plugins start until they have", () =>
    Effect.gen(function* () {
      const home = yield* CawHome;
      const lifecycle = yield* DaemonLifecycle;

      const result = yield* Effect.gen(function* () {
        const client = yield* CawClient;

        const pending = yield* Effect.forkChild(
          Effect.exit(
            client.RunCommand({ argv: ["nope"], conversationId: Option.none(), cwd: "/" }),
          ),
        );

        yield* Effect.sleep("100 millis");
        const waited = pending.pollUnsafe() === undefined;

        yield* lifecycle.markReady;

        return { waited, answer: yield* Fiber.join(pending) };
      }).pipe(Effect.provide(CawClient.layer(home.socket)));

      expect(result.waited).toBe(true);
      expect(result.answer).toEqual(
        Exit.fail(expect.objectContaining({ message: "Unknown command: nope" })),
      );
    }).pipe(Effect.provide(server), Effect.scoped),
  );
});
