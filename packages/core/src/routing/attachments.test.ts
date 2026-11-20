import * as Fs from "node:fs/promises";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option } from "effect";
import { temporaryHome, testCoreLayer, message } from "../testing/test-daemon.ts";
import { Attachments } from "./attachments.ts";

class HomeDir extends Context.Service<HomeDir, string>()("test/HomeDir") {}

const daemon = Layer.unwrap(
  Effect.map(temporaryHome, (home) =>
    Layer.merge(testCoreLayer(home), Layer.succeed(HomeDir, home)),
  ),
);

describe("Attachments", () => {
  it.effect("saves attachments into the Workspace inbox", () =>
    Effect.gen(function* () {
      const attachments = yield* Attachments;
      const home = yield* HomeDir;
      const workspace = `${home}/conversations/c1`;

      const received = {
        ...message("dm", "m1", "pic"),
        attachments: [
          { name: "../cat.png", url: "https://cdn/cat.png", contentType: Option.some("image/png") },
        ],
      };

      const saved = yield* attachments.save(workspace, received);
      const path = `${workspace}/inbox/m1/cat.png`;

      expect(saved).toEqual([{ name: "../cat.png", kind: "image", savedTo: Option.some(path) }]);
      expect(yield* Effect.promise(() => Fs.readFile(path, "utf8"))).toBe(
        "bytes of https://cdn/cat.png",
      );
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );
});
