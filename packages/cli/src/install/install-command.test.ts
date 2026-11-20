import { Database } from "bun:sqlite";
import * as Fs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { BunServices } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { OfflineHost } from "@omen/core/offline-host";
import { OmenHome } from "@omen/core/omen-home";
import { ConfigProvider, Console, Effect, Exit, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { runLocal } from "../cli.ts";
import { Daemon } from "../daemon.ts";
import { Invocation } from "../invocation.ts";

const temporaryHome = Effect.acquireRelease(
  Effect.promise(() => Fs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "omen-install-"))),
  (path) => Effect.promise(() => Fs.rm(path, { recursive: true, force: true })),
);

/** Discord's REST API for a valid token whose bot is in no server yet. */
const fakeDiscord = HttpClient.make((request) => {
  const body = (json: string, status = 200) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(json, { status, headers: { "content-type": "application/json" } }),
      ),
    );

  if (request.headers["authorization"] !== "Bot good-token") {
    return body('{"message":"401: Unauthorized"}', 401);
  }

  if (request.url.endsWith("/users/@me")) {
    return body('{"id":"bot-1","username":"omen-bot"}');
  }

  if (request.url.endsWith("/users/@me/guilds")) {
    return body("[]");
  }

  return body('{"id":"app-1"}');
});

const lines: Array<string> = [];

/** Keeps what the wizard prints, stdout and stderr together. */
const recording: Console.Console = {
  ...globalThis.console,
  log: (...parts: ReadonlyArray<unknown>) => {
    lines.push(parts.join(" "));
  },
  error: (...parts: ReadonlyArray<unknown>) => {
    lines.push(parts.join(" "));
  },
};

/** `omen <argv>` in this process, on `home`, with Discord faked and macOS as the platform. */
const omen = (home: string, argv: ReadonlyArray<string>) =>
  runLocal(argv).pipe(
    Effect.provide(
      Layer.mergeAll(
        OfflineHost.standalone,
        Daemon.layer.pipe(Layer.provideMerge(OmenHome.layer)),
        Layer.succeed(Invocation, {
          cwd: home,
          conversationId: Option.none(),
          platform: "darwin",
          bun: "/usr/local/bin/bun",
          userId: Option.some(501),
        }),
        Layer.succeed(HttpClient.HttpClient, fakeDiscord),
        BunServices.layer,
      ).pipe(
        Layer.provideMerge(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { OMEN_HOME: home, HOME: home, PATH: "/usr/bin" } }),
          ),
        ),
      ),
    ),
    Effect.provideService(Console.Console, recording),
  );

const pluginsTable = (home: string) => {
  const db = new Database(NodePath.join(home, "omen.db"), { readonly: true });
  const rows = db.query('select name, enabled from plugins order by "order"').all();

  db.close();

  return rows;
};

describe("omen install", () => {
  it.live("sets Omen up from flags alone", () =>
    Effect.gen(function* () {
      const home = yield* temporaryHome;
      const tokenFile = NodePath.join(home, "token");

      lines.length = 0;
      yield* Effect.promise(() => Fs.writeFile(tokenFile, "good-token\n"));
      yield* Effect.promise(() => Fs.writeFile(NodePath.join(home, ".env"), "# mine\nOTHER=1\n"));

      yield* omen(home, [
        "install",
        "--yes",
        "--discord-token-file",
        tokenFile,
        "--model",
        "sonnet",
        "--plugins",
        "memory,profiles",
        "--service",
      ]);

      const output = lines.join("\n");

      expect(output).toContain("Bot: omen-bot");
      expect(output).toContain(
        "https://discord.com/oauth2/authorize?client_id=app-1&scope=bot%20applications.commands&permissions=",
      );
      expect(output).toContain("Turn on the Message Content intent");
      expect(output).toContain("Saved profile default  harness=claude  model=sonnet");
      expect(output).toContain("Load the service with: launchctl bootstrap gui/501 ");

      const env = NodePath.join(home, ".env");

      expect(yield* Effect.promise(() => Fs.readFile(env, "utf8"))).toBe(
        "# mine\nOTHER=1\nDISCORD_TOKEN=good-token\n",
      );
      expect(((yield* Effect.promise(() => Fs.stat(env))).mode & 0o777).toString(8)).toBe("600");

      expect(pluginsTable(home)).toEqual([
        { name: "discord", enabled: 1 },
        { name: "claude", enabled: 1 },
        { name: "memory", enabled: 1 },
        { name: "scheduler", enabled: 0 },
        { name: "profiles", enabled: 1 },
      ]);

      const plist = yield* Effect.promise(() =>
        Fs.readFile(NodePath.join(home, "Library", "LaunchAgents", "omen.plist"), "utf8"),
      );

      expect(plist).toContain(`<key>OMEN_HOME</key>\n    <string>${home}</string>`);
      expect(plist).toContain("<string>/usr/local/bin/bun</string>");
    }).pipe(Effect.scoped),
  );

  it.live("fails with the Channel's reason when the token is rejected", () =>
    Effect.gen(function* () {
      const home = yield* temporaryHome;
      const tokenFile = NodePath.join(home, "token");

      yield* Effect.promise(() => Fs.writeFile(tokenFile, "bad-token"));

      expect(
        yield* Effect.exit(omen(home, ["install", "--yes", "--discord-token-file", tokenFile])),
      ).toEqual(Exit.fail(expect.objectContaining({ message: "Discord rejected the bot token." })));
      expect(yield* Effect.exit(omen(home, ["install", "--yes"]))).toEqual(
        Exit.fail(expect.objectContaining({ message: "Pass --discord-token-file." })),
      );
    }).pipe(Effect.scoped),
  );
});
