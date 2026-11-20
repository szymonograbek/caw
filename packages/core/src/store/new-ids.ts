import { ConversationId, SessionId } from "@omen/sdk/ids";
import { Effect, Random } from "effect";

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

/** A version 4 UUID drawn from Effect's `Random`, so tests can seed it. */
const uuid = Effect.gen(function* () {
  const bytes = yield* Effect.replicateEffect(Random.nextIntBetween(0, 255), 16);
  const [b6 = 0, b8 = 0] = [bytes[6], bytes[8]];
  const versioned = [...bytes.slice(0, 6), (b6 & 0x0f) | 0x40, bytes[7] ?? 0, (b8 & 0x3f) | 0x80];
  const digits = [...versioned, ...bytes.slice(9)].map(hex).join("");

  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    digits.slice(12, 16),
    digits.slice(16, 20),
    digits.slice(20),
  ].join("-");
});

export const newConversationId = Effect.map(uuid, (id) => ConversationId.make(id));

export const newSessionId = Effect.map(uuid, (id) => SessionId.make(id));
