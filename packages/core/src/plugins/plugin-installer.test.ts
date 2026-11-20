import * as Fs from "node:fs/promises";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { CawHome } from "../home/caw-home.ts";
import { temporaryHome, testCoreLayer } from "../testing/test-daemon.ts";
import { PluginHost } from "./plugin-host.ts";
import { Registry } from "./registry.ts";

const daemon = Layer.unwrap(Effect.map(temporaryHome, (home) => testCoreLayer(home)));

/** A Plugin package outside the repo that registers `caw echo`. */
const writeFixture = (folder: string) =>
  Effect.promise(async () => {
    const effect = import.meta.resolve("effect");
    const sdk = import.meta.resolve("@caw/sdk/plugin");

    await Fs.mkdir(folder, { recursive: true });
    await Fs.writeFile(
      NodePath.join(folder, "package.json"),
      '{ "name": "caw-plugin-echo", "version": "1.0.0", "type": "module", "main": "index.js", "caw": { "name": "echo", "version": "1.0.0" } }',
    );
    await Fs.writeFile(
      NodePath.join(folder, "index.js"),
      [
        `import { Effect, Layer, Option, Schema } from "${effect}";`,
        `import { Caw } from "${sdk}";`,
        "export default {",
        '  name: "echo",',
        "  settings: Schema.Struct({}),",
        "  migrations: [],",
        '  guide: [{ topic: "echo", summary: "Echoes", body: "caw echo <words>" }],',
        "  skillDir: Option.none(),",
        "  layer: () => Layer.effectDiscard(Effect.gen(function* () {",
        "    const caw = yield* Caw;",
        '    yield* caw.registerCliCommand({ name: "echo", summary: "Echoes", run: (args) => Effect.succeed(args.join(" ")) });',
        "  })),",
        "};",
      ].join("\n"),
    );
  });

describe("PluginInstaller", () => {
  it.live("installs a Plugin with bun and runs its default export", () =>
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const registry = yield* Registry;
      const home = yield* CawHome;
      const source = NodePath.join(home.root, "source", "echo");

      yield* writeFixture(source);
      yield* host.start([]);

      const name = yield* host.install(source);
      const command = yield* registry.cliCommand("echo");

      const output = yield* Option.match(command, {
        onNone: () => Effect.succeed("missing"),
        onSome: (found) =>
          found.run(["hello", "there"], { conversationId: Option.none(), cwd: "/" }),
      });

      expect(name).toBe("echo");
      expect(output).toBe("hello there");
      expect(
        (yield* host.list).map(({ row, state }) => [row.name, row.source, row.version, state._tag]),
      ).toEqual([["echo", source, "1.0.0", "Running"]]);
    }).pipe(Effect.provide(daemon), Effect.scoped),
  );
});
