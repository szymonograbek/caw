import { BunSocket } from "@effect/platform-bun";
import { Context, Layer } from "effect";
import type { RpcClientError, RpcGroup } from "effect/rpc";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { OmenRpcs } from "./omen-rpcs.ts";

/** The CLI's typed connection to a running daemon. */
export class OmenClient extends Context.Service<
  OmenClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof OmenRpcs>, RpcClientError.RpcClientError>
>()("@omen/core/OmenClient") {
  /** Connects to the daemon's socket (`OmenHome.socket`). */
  static readonly layer = (socket: string) =>
    Layer.effect(OmenClient, RpcClient.make(OmenRpcs)).pipe(
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
