import { describe, expect, it } from "@effect/vitest";
import { ConversationPlace } from "@gloaming/caw-plugin-sdk/channel";
import { PluginName } from "@gloaming/caw-plugin-sdk/ids";
import { Effect, Layer, Ref } from "effect";
import { makeFakeChannel } from "../testing/fake-channel.ts";
import { makeFakeHarness } from "../testing/fake-harness.ts";
import {
  eventually,
  message,
  startPlugins,
  temporaryHome,
  testCoreLayer,
} from "../testing/test-daemon.ts";
import { PluginHost } from "./plugin-host.ts";
import { Registry } from "./registry.ts";

const daemon = Layer.unwrap(Effect.map(temporaryHome, (home) => testCoreLayer(home)));

const fake = PluginName.make("fake");

describe("PluginHost", () => {
  it.effect("removes a disabled Plugin's registrations and closes live Sessions", () =>
    Effect.gen(function* () {
      const channel = yield* makeFakeChannel;
      const harness = yield* makeFakeHarness;
      const host = yield* PluginHost;
      const registry = yield* Registry;

      yield* startPlugins(channel, harness);
      expect((yield* registry.all).map((entry) => entry._tag)).toEqual([
        "Harness",
        "Profiles",
        "Channel",
      ]);

      yield* channel.say(message("dm", "m1", "hi", ConversationPlace.Direct()));
      yield* eventually(Effect.map(Ref.get(channel.sent), (sent) => sent.length === 1));
      yield* host.disable(fake);

      const [session] = yield* Ref.get(harness.sessions);

      expect(yield* registry.all).toEqual([]);
      expect(yield* Ref.get(session?.closed ?? Ref.makeUnsafe(false))).toBe(true);
      expect((yield* host.list).map(({ row, state }) => [row.name, state._tag])).toEqual([
        ["fake", "Disabled"],
      ]);

      yield* host.enable(fake);
      expect(yield* registry.all).toHaveLength(3);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );
});
