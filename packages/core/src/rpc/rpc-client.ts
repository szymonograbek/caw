import { BunSocket } from "@effect/platform-bun";
import { Context, Layer } from "effect";
import type { RpcClientError, RpcGroup } from "effect/rpc";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { CawRpcs } from "./caw-rpcs.ts";

/** The CLI's typed connection to a running daemon. */
export class CawClient extends Context.Service<
  CawClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof CawRpcs>, RpcClientError.RpcClientError>
>()("@caw/core/CawClient") {
  /** Connects to the daemon's socket (`CawHome.socket`). */
  static readonly layer = (socket: string) =>
    Layer.effect(CawClient, RpcClient.make(CawRpcs)).pipe(
      Layer.provide(
        RpcClient.layerProtocolSocket().pipe(
          Layer.provide([
            // SAFETY: `@effect/platform-bun` is an allowed unstable API; its socket layers
            // re-export `@effect/platform-node-shared`, which the check attributes separately.
            // @effect-diagnostics-next-line unstableApiUsage:off
            BunSocket.layerNet({ path: socket }),
            RpcSerialization.layerNdjson,
          ]),
        ),
      ),
    );
}
