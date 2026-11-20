import type { DaemonStatus } from "@omen/core/omen-rpcs";
import { OmenHome } from "@omen/core/omen-home";
import { OmenClient } from "@omen/core/rpc-client";
import type { ConversationId } from "@omen/sdk/ids";
import type { CliCommandError } from "@omen/sdk/plugin";
import { Cause, Context, Effect, Layer, Option, Schema } from "effect";
import type { RpcClientError } from "effect/rpc";

export class DaemonNotRunning extends Schema.TaggedError<
  DaemonNotRunning,
  { readonly brand: unique symbol }
>()("DaemonNotRunning", {}) {}

/** The daemon answers when it serves `Status` within this long. */
const answerWithin = "2 seconds";

/** Fails with `DaemonNotRunning` unless the daemon answers in time. */
const answered = (client: OmenClient["Service"]) =>
  client.Status().pipe(
    Effect.timeout(answerWithin),
    Effect.catchTags({
      RpcClientError: () => Effect.fail(new DaemonNotRunning()),
      TimeoutError: () => Effect.fail(new DaemonNotRunning()),
    }),
  );

/** A call the daemon dropped, e.g. because it stopped meanwhile. */
const lost = <A, E>(call: Effect.Effect<A, E | RpcClientError.RpcClientError>) =>
  Effect.catchTag(call, "RpcClientError", () => Effect.fail(new DaemonNotRunning()));

/** The running daemon, reached over `<home>/omen.sock`. Each call opens its own connection. */
export class Daemon extends Context.Service<
  Daemon,
  {
    /** `None` when no daemon answers. */
    readonly status: Effect.Effect<Option.Option<DaemonStatus>>;
    readonly shutdown: Effect.Effect<void, DaemonNotRunning>;
    /** `omen <argv>` run inside the daemon; returns what it printed. */
    readonly run: (request: {
      readonly argv: ReadonlyArray<string>;
      readonly conversationId: Option.Option<ConversationId>;
      readonly cwd: string;
    }) => Effect.Effect<string, CliCommandError | DaemonNotRunning>;
  }
>()("@omen/cli/Daemon") {
  static readonly layer = Layer.effect(
    Daemon,
    Effect.gen(function* () {
      const home = yield* OmenHome;
      const connection = OmenClient.layer(home.socket);

      /** Connects for one call; a socket that does not open means no daemon. */
      const reach = <A, E>(use: Effect.Effect<A, E, OmenClient>) =>
        Layer.build(connection).pipe(
          Effect.flatMap((client) => Effect.provideContext(use, client)),
          Effect.scoped,
          Effect.catchTag("SocketError", () => Effect.fail(new DaemonNotRunning())),
        );

      return {
        status: reach(OmenClient.use(answered)).pipe(
          Effect.asSome,
          Effect.catchTag("DaemonNotRunning", () => Effect.succeedNone),
        ),
        shutdown: reach(
          OmenClient.use((client) =>
            Effect.andThen(
              answered(client),
              // The daemon may close the connection before its reply arrives; it is stopping either way.
              lost(client.Shutdown()).pipe(
                Effect.catchCauseIf(Cause.hasInterruptsOnly, () => Effect.void),
              ),
            ),
          ),
        ),
        run: (request) =>
          reach(
            OmenClient.use((client) =>
              Effect.andThen(answered(client), lost(client.RunCommand(request))),
            ),
          ),
      };
    }),
  );
}
