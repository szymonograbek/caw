import { Effect, Option } from "effect";
import { claudeError } from "./claude-error.ts";

/**
 * Caw runs the Claude Code installed on the host, the same `claude` a shell
 * starts, rather than the copy inside the SDK package: that copy is not on disk
 * in a compiled `caw` binary. It must be the SDK's Claude Code version or newer.
 */
export const findClaudeExecutable = (path: string): Option.Option<string> =>
  Option.fromNullishOr(Bun.which("claude", { PATH: path }));

export const notInstalled =
  "Claude Code is not installed: no `claude` on PATH. Install it from https://claude.com/claude-code";

/** The `claude` executable on `path`, for a Session about to start. */
export const claudeExecutable = (path: string) =>
  Effect.fromOption(findClaudeExecutable(path)).pipe(
    Effect.mapError(() => claudeError(notInstalled, undefined)),
  );
