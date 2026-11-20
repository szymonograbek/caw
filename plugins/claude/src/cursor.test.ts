import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { HarnessError } from "@gloaming/caw-plugin-sdk/harness";
import { ClaudeSessionId, decodeCursor, encodeCursor } from "./cursor.ts";

describe("resume cursor", () => {
  it.effect("decodes the session id it encoded", () =>
    Effect.gen(function* () {
      const sessionId = ClaudeSessionId.make("10b3de0b-39c0-44d7-baf5-3be3313e1871");
      const cursor = encodeCursor(sessionId);

      expect(cursor).toEqual({ sessionId: "10b3de0b-39c0-44d7-baf5-3be3313e1871" });
      expect(yield* decodeCursor(cursor)).toBe(sessionId);
    }),
  );

  it.effect("rejects a cursor from another Harness as a HarnessError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeCursor({ threadId: "t-1" }));

      expect(error).toBeInstanceOf(HarnessError);
    }),
  );
});
