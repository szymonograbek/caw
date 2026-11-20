import { ConversationId } from "@omen/sdk/ids";
import { Config, Context, Effect, Layer, Option } from "effect";

/** Facts about this `omen` process that commands act on; tests substitute their own. */
export class Invocation extends Context.Service<
  Invocation,
  {
    /** The invoking shell's working directory. */
    readonly cwd: string;
    /** `OMEN_CONVERSATION_ID`, set when the agent runs `omen` inside a Session. */
    readonly conversationId: Option.Option<ConversationId>;
    /** `process.platform`; decides which service file `omen install` writes. */
    readonly platform: string;
    /** The Bun binary running the CLI, which the service file runs too. */
    readonly bun: string;
    /** The user id `launchctl bootstrap gui/<uid>` needs. */
    readonly userId: Option.Option<number>;
  }
>()("@omen/cli/Invocation") {
  /** This process: the one place the CLI reads `process`. */
  static readonly layer = Layer.effect(
    Invocation,
    Effect.gen(function* () {
      const conversationId = yield* Config.option(
        Config.String("OMEN_CONVERSATION_ID").pipe(Config.map((id) => ConversationId.make(id))),
      );

      return {
        cwd: process.cwd(),
        conversationId,
        platform: process.platform,
        bun: process.execPath,
        userId: Option.fromNullishOr(process.getuid?.()),
      };
    }),
  );
}
