import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { adoptDefaultAvatar } from "./default-avatar.ts";

/** A fake bot that records each avatar it is given, or refuses them all like a rate-limited Discord. */
const fakeBot = (avatar: string | null, discord: "accepts" | "refuses") => {
  const uploaded: Array<string> = [];

  const profile = {
    avatar,
    setAvatar: (image: string) => {
      uploaded.push(image);

      return discord === "accepts"
        ? Promise.resolve(profile)
        : Promise.reject(new Error("You are changing your avatar too fast"));
    },
  };

  return { uploaded, profile };
};

describe("adoptDefaultAvatar", () => {
  it.effect("gives a bot without an avatar Caw's PNG", () =>
    Effect.gen(function* () {
      const bot = fakeBot(null, "accepts");

      yield* adoptDefaultAvatar(bot.profile);

      expect(bot.uploaded).toHaveLength(1);
      expect(bot.uploaded[0]).toMatch(/^data:image\/png;base64,/);
    }),
  );

  it.effect("keeps an avatar the owner already set", () =>
    Effect.gen(function* () {
      const bot = fakeBot("owner-avatar-hash", "accepts");

      yield* adoptDefaultAvatar(bot.profile);

      expect(bot.uploaded).toEqual([]);
    }),
  );

  it.effect("carries on when Discord refuses the change", () =>
    Effect.gen(function* () {
      const bot = fakeBot(null, "refuses");

      yield* adoptDefaultAvatar(bot.profile);

      expect(bot.uploaded).toHaveLength(1);
    }),
  );
});
