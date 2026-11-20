import * as NodePath from "node:path";
import type { ChannelMessageId, ConversationId } from "@omen/sdk/ids";
import { Config, Context, Effect, Layer } from "effect";

/**
 * Every path Omen keeps state under. The root is `OMEN_HOME`, else `~/.omen`,
 * so moving machines is a folder copy.
 */
export class OmenHome extends Context.Service<
  OmenHome,
  {
    readonly root: string;
    readonly database: string;
    readonly socket: string;
    readonly logFile: string;
    readonly envFile: string;
    readonly pluginsDir: string;
    /** Holds the `omen` shim Sessions find on their `PATH`. */
    readonly binDir: string;
    /** Omen's core skill, a Claude Code local plugin every Session loads. */
    readonly skillDir: string;
    /** The Workspace of a top-level Conversation. */
    readonly workspace: (root: ConversationId) => string;
    /** Where one message's attachments are saved inside a Workspace. */
    readonly inbox: (workspace: string, message: ChannelMessageId) => string;
  }
>()("@omen/core/OmenHome") {
  static readonly at = (root: string): OmenHome["Service"] => {
    const absolute = NodePath.resolve(root);

    return {
      root: absolute,
      database: NodePath.join(absolute, "omen.db"),
      socket: NodePath.join(absolute, "omen.sock"),
      logFile: NodePath.join(absolute, "logs", "omen.log"),
      envFile: NodePath.join(absolute, ".env"),
      pluginsDir: NodePath.join(absolute, "plugins"),
      binDir: NodePath.join(absolute, "bin"),
      skillDir: NodePath.join(absolute, "skill"),
      workspace: (conversation) => NodePath.join(absolute, "conversations", conversation),
      inbox: (workspace, message) => NodePath.join(workspace, "inbox", message),
    };
  };

  static readonly layer = Layer.effect(
    OmenHome,
    Effect.gen(function* () {
      // `HOME` is read only without `OMEN_HOME`, so the agent's shim runs in any environment.
      const root = yield* Config.String("OMEN_HOME").pipe(
        Config.orElse(() =>
          Config.String("HOME").pipe(Config.map((home) => NodePath.join(home, ".omen"))),
        ),
      );

      return OmenHome.at(root);
    }),
  );
}
