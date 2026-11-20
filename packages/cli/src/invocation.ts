import { ConversationId } from "@gloaming/caw-plugin-sdk/ids";
import { Config, Context, Effect, Layer, Option } from "effect";

/** `bun build --compile` serves the bundled modules from Bun's virtual `/$bunfs` root. */
const compiled = import.meta.dirname.startsWith("/$bunfs");

/** Facts about this `caw` process that commands act on; tests substitute their own. */
export class Invocation extends Context.Service<
  Invocation,
  {
    /** The invoking shell's working directory. */
    readonly cwd: string;
    /** `CAW_CONVERSATION_ID`, set when the agent runs `caw` inside a Session. */
    readonly conversationId: Option.Option<ConversationId>;
    /** `process.platform`; decides which service file `caw install` writes. */
    readonly platform: string;
    /**
     * The command that starts this CLI, for the `caw` shim and service files:
     * `[bun, entry script]` from source or the npm bundle, or just the binary when compiled.
     */
    readonly cli: ReadonlyArray<string>;
    /** The user id `launchctl bootstrap gui/<uid>` needs. */
    readonly userId: Option.Option<number>;
  }
>()("@gloaming/caw/Invocation") {
  /** This process: the one place the CLI reads `process`. */
  static readonly layer = Layer.effect(
    Invocation,
    Effect.gen(function* () {
      const conversationId = yield* Config.option(
        Config.String("CAW_CONVERSATION_ID").pipe(Config.map((id) => ConversationId.make(id))),
      );

      return {
        cwd: process.cwd(),
        conversationId,
        platform: process.platform,
        cli: compiled ? [process.execPath] : [process.execPath, Bun.main],
        userId: Option.fromNullishOr(process.getuid?.()),
      };
    }),
  );
}
