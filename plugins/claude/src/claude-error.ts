import { HarnessName } from "@gloaming/caw-plugin-sdk/ids";
import { HarnessError } from "@gloaming/caw-plugin-sdk/harness";

export const claudeHarnessName = HarnessName.make("claude");

/** A `HarnessError` raised by the Claude Harness. */
export const claudeError = (message: string, cause: unknown) =>
  new HarnessError({ harness: claudeHarnessName, message, cause });
