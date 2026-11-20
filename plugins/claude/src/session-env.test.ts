import { describe, expect, it } from "@effect/vitest";
import { sessionEnv } from "./session-env.ts";

describe("sessionEnv", () => {
  it("names Caw as Claude Code's entrypoint, over an inherited one", () => {
    expect(sessionEnv({ PATH: "/usr/bin", CLAUDE_CODE_ENTRYPOINT: "cli" })).toEqual({
      PATH: "/usr/bin",
      CLAUDE_CODE_ENTRYPOINT: "caw",
    });
  });
});
