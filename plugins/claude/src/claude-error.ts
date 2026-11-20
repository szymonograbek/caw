import { HarnessName } from "@omen/sdk/ids";
import { HarnessError } from "@omen/sdk/harness";

export const claudeHarnessName = HarnessName.make("claude");

/** A `HarnessError` raised by the Claude Harness. */
export const claudeError = (message: string, cause: unknown) =>
  new HarnessError({ harness: claudeHarnessName, message, cause });
