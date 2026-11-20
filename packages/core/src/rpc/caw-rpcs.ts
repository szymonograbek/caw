import { ConversationId, PluginName } from "@gloaming/sdk/ids";
import { CliCommandError } from "@gloaming/sdk/plugin";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { PluginState } from "../plugins/plugin-state.ts";

export class PluginStatus extends Schema.Class<PluginStatus, { readonly brand: unique symbol }>(
  "PluginStatus",
)({
  name: PluginName,
  source: Schema.String,
  version: Schema.String,
  state: PluginState,
}) {}

export class DaemonStatus extends Schema.Class<DaemonStatus, { readonly brand: unique symbol }>(
  "DaemonStatus",
)({
  pid: Schema.Int,
  startedAt: Schema.DateTimeUtc,
  plugins: Schema.Array(PluginStatus),
  liveSessions: Schema.Int,
}) {}

/** What the `caw` CLI asks the daemon over `<home>/caw.sock`. */
export const CawRpcs = RpcGroup.make(
  Rpc.make("Status", { success: DaemonStatus }),
  Rpc.make("Shutdown"),
  /** Runs `caw <argv>` inside the daemon and returns what the CLI prints. */
  Rpc.make("RunCommand", {
    payload: {
      argv: Schema.Array(Schema.String),
      /** From `CAW_CONVERSATION_ID` when the agent runs the CLI inside a Session. */
      conversationId: Schema.Option(ConversationId),
      /** The invoking shell's working directory. */
      cwd: Schema.String,
    },
    success: Schema.String,
    error: CliCommandError,
  }),
);
