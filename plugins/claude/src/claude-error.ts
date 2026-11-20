import { HarnessName } from "@gloaming/sdk/ids";
import { HarnessError } from "@gloaming/sdk/harness";

export const claudeHarnessName = HarnessName.make("claude");

/** A `HarnessError` raised by the Claude Harness. */
export const claudeError = (message: string, cause: unknown) =>
  new HarnessError({ harness: claudeHarnessName, message, cause });
