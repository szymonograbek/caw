import { Data, Runtime } from "effect";

/**
 * Ends the CLI with exit code 1. `main` prints `message` on stderr, so the
 * runtime does not log it again.
 */
export class CliFailure extends Data.TaggedError("CliFailure")<{ readonly message: string }> {
  override readonly [Runtime.errorReported] = false;
}
