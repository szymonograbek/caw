import * as NodePath from "node:path";
import type { ChannelMessageId, ConversationId } from "@gloaming/sdk/ids";
import { Config, Context, Effect, Layer } from "effect";

/**
 * Every path Caw keeps state under. The root is `CAW_HOME`, else `~/.caw`,
 * so moving machines is a folder copy.
 */
export class CawHome extends Context.Service<
  CawHome,
  {
    readonly root: string;
    readonly database: string;
    readonly socket: string;
    readonly logFile: string;
    readonly envFile: string;
    readonly pluginsDir: string;
    /** Holds the `caw` shim Sessions find on their `PATH`. */
    readonly binDir: string;
    /** Caw's core skill, a Claude Code local plugin every Session loads. */
    readonly skillDir: string;
    /** The Workspace of a top-level Conversation. */
    readonly workspace: (root: ConversationId) => string;
    /** Where one message's attachments are saved inside a Workspace. */
    readonly inbox: (workspace: string, message: ChannelMessageId) => string;
  }
>()("@gloaming/core/CawHome") {
  static readonly at = (root: string): CawHome["Service"] => {
    const absolute = NodePath.resolve(root);

    return {
      root: absolute,
      database: NodePath.join(absolute, "caw.db"),
      socket: NodePath.join(absolute, "caw.sock"),
      logFile: NodePath.join(absolute, "logs", "caw.log"),
      envFile: NodePath.join(absolute, ".env"),
      pluginsDir: NodePath.join(absolute, "plugins"),
      binDir: NodePath.join(absolute, "bin"),
      skillDir: NodePath.join(absolute, "skill"),
      workspace: (conversation) => NodePath.join(absolute, "conversations", conversation),
      inbox: (workspace, message) => NodePath.join(workspace, "inbox", message),
    };
  };

  static readonly layer = Layer.effect(
    CawHome,
    Effect.gen(function* () {
      // `HOME` is read only without `CAW_HOME`, so the agent's shim runs in any environment.
      const root = yield* Config.String("CAW_HOME").pipe(
        Config.orElse(() =>
          Config.String("HOME").pipe(Config.map((home) => NodePath.join(home, ".caw"))),
        ),
      );

      return CawHome.at(root);
    }),
  );
}
