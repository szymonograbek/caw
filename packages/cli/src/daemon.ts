import type { DaemonStatus } from "@gloaming/core/caw-rpcs";
import { CawHome } from "@gloaming/core/caw-home";
import { CawClient } from "@gloaming/core/rpc-client";
import type { ConversationId } from "@gloaming/sdk/ids";
import type { CliCommandError } from "@gloaming/sdk/plugin";
import { Cause, Context, Effect, Layer, Option, Schedule, Schema } from "effect";
import type { RpcClientError } from "effect/rpc";

export class DaemonNotRunning extends Schema.TaggedError<
  DaemonNotRunning,
  { readonly brand: unique symbol }
>()("DaemonNotRunning", {}) {}

/** The daemon answers when it serves `Status` within this long. */
const answerWithin = "2 seconds";

/** Fails with `DaemonNotRunning` unless the daemon answers in time. */
const answered = (client: CawClient["Service"]) =>
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

/** The running daemon, reached over `<home>/caw.sock`. Each call opens its own connection. */
export class Daemon extends Context.Service<
  Daemon,
  {
    /** `None` when no daemon answers. */
    readonly status: Effect.Effect<Option.Option<DaemonStatus>>;
    readonly shutdown: Effect.Effect<void, DaemonNotRunning>;
    /** `caw <argv>` run inside the daemon; returns what it printed. */
    readonly run: (request: {
      readonly argv: ReadonlyArray<string>;
      readonly conversationId: Option.Option<ConversationId>;
      readonly cwd: string;
    }) => Effect.Effect<string, CliCommandError | DaemonNotRunning>;
  }
>()("@gloaming/cli/Daemon") {
  static readonly layer = Layer.effect(
    Daemon,
    Effect.gen(function* () {
      const home = yield* CawHome;
      const connection = CawClient.layer(home.socket);

      /** Connects for one call; a socket that does not open means no daemon. */
      const reach = <A, E>(use: Effect.Effect<A, E, CawClient>) =>
        Layer.build(connection).pipe(
          Effect.flatMap((client) => Effect.provideContext(use, client)),
          Effect.scoped,
          Effect.catchTag("SocketError", () => Effect.fail(new DaemonNotRunning())),
        );

      return {
        status: reach(CawClient.use(answered)).pipe(
          Effect.asSome,
          Effect.catchTag("DaemonNotRunning", () => Effect.succeedNone),
        ),
        shutdown: reach(
          CawClient.use((client) =>
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
            CawClient.use((client) =>
              Effect.andThen(answered(client), lost(client.RunCommand(request))),
            ),
          ),
      };
    }),
  );
}

/**
 * Asks for the daemon's status every 100 ms until `until` holds, at most
 * `times` more times, and returns the last status.
 */
export const pollStatus = (
  daemon: Daemon["Service"],
  until: (status: Option.Option<DaemonStatus>) => boolean,
  times: number,
) => daemon.status.pipe(Effect.repeat({ schedule: Schedule.spaced("100 millis"), until, times }));
