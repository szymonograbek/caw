import { Database } from "bun:sqlite";
import * as Fs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { BunServices } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { OfflineHost } from "@gloaming/core/offline-host";
import { CawHome } from "@gloaming/core/caw-home";
import { DaemonStatus } from "@gloaming/core/caw-rpcs";
import { ConfigProvider, DateTime, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { runLocal } from "../cli.ts";
import { Daemon, DaemonNotRunning } from "../daemon.ts";
import { Invocation } from "../invocation.ts";
import { Processes } from "./processes.ts";
import { WizardUi } from "./wizard-ui.ts";

const temporaryHome = Effect.acquireRelease(
  Effect.promise(() => Fs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "caw-install-"))),
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
    return body('{"id":"bot-1","username":"caw-bot"}');
  }

  if (request.url.endsWith("/users/@me/guilds")) {
    return body("[]");
  }

  return body('{"id":"app-1"}');
});

const printed: Array<string> = [];
const ran: Array<string> = [];

const running = new DaemonStatus({
  pid: 4242,
  startedAt: DateTime.makeUnsafe(0),
  plugins: [],
  liveSessions: 0,
});

const record = (line: string) =>
  Effect.sync(() => {
    ran.push(line);
  });

/**
 * A daemon and the processes that start it, sharing whether it runs. Like
 * launchd: `bootout` fails when nothing is loaded, the service stays held for
 * two `print` checks after `bootout`, and `bootstrap` fails with 5 while it is held.
 */
const fakeCaw = (alreadyRunning: boolean, serviceLoaded: boolean) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const status = yield* Ref.make(alreadyRunning ? Option.some(running) : Option.none());
      const loaded = yield* Ref.make(serviceLoaded);
      const releasing = yield* Ref.make(0);

      const held = Effect.zipWith(
        Ref.get(loaded),
        Ref.get(releasing),
        (on, left) => on || left > 0,
      );

      return Layer.merge(
        Layer.succeed(Daemon, {
          status: Ref.get(status),
          shutdown: Ref.get(status).pipe(
            Effect.filterOrFail(Option.isSome, () => new DaemonNotRunning()),
            Effect.andThen(record("Shutdown RPC")),
            Effect.andThen(Ref.set(status, Option.none())),
          ),
          run: () => Effect.die("The wizard forwarded a command."),
        }),
        Layer.succeed(Processes, {
          run: (command) =>
            Effect.gen(function* () {
              const verb = command[1];

              if (verb === "print") {
                const isHeld = yield* held;

                yield* Ref.update(releasing, (left) => Math.max(0, left - 1));

                return isHeld
                  ? { code: 0, output: "" }
                  : { code: 113, output: "Could not find service" };
              }

              yield* record(command.join(" "));

              if (verb === "bootout") {
                if (!(yield* Ref.get(loaded))) {
                  return { code: 5, output: "Boot-out failed: 5: Input/output error" };
                }

                yield* Ref.set(loaded, false);
                yield* Ref.set(releasing, 2);
                yield* Ref.set(status, Option.none());

                return { code: 0, output: "" };
              }

              if (verb === "bootstrap") {
                if (yield* held) {
                  return { code: 5, output: "Bootstrap failed: 5: Input/output error" };
                }

                yield* Ref.set(loaded, true);
                yield* Ref.set(status, Option.some(running));
              }

              return { code: 0, output: "" };
            }),
          startDetached: (command, env, output) =>
            Effect.andThen(
              record(`detached ${command.join(" ")} CAW_HOME=${env["CAW_HOME"]} >> ${output}`),
              Ref.set(status, Option.some(running)),
            ),
        }),
      );
    }),
  );

/** `caw <argv>` in this process, on `home`, with Discord and the daemon faked and macOS as the platform. */
const caw = (
  home: string,
  argv: ReadonlyArray<string>,
  alreadyRunning = false,
  serviceLoaded = false,
) =>
  runLocal(argv).pipe(
    Effect.provide(
      Layer.mergeAll(
        OfflineHost.standalone,
        CawHome.layer,
        fakeCaw(alreadyRunning, serviceLoaded),
        WizardUi.recording(printed),
        Layer.succeed(Invocation, {
          cwd: home,
          conversationId: Option.none(),
          platform: "darwin",
          cli: ["/usr/local/bin/bun", "/opt/caw/main.ts"],
          userId: Option.some(501),
        }),
        Layer.succeed(HttpClient.HttpClient, fakeDiscord),
        BunServices.layer,
      ).pipe(
        Layer.provideMerge(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                CAW_HOME: home,
                HOME: home,
                PATH: "/usr/bin",
                CLAUDE_CONFIG_DIR: NodePath.join(home, ".claude"),
              },
            }),
          ),
        ),
      ),
    ),
  );

/** Starts a test from nothing printed or run, with a token file in a fresh home. */
const freshHome = Effect.gen(function* () {
  const home = yield* temporaryHome;
  const tokenFile = NodePath.join(home, "token");

  printed.length = 0;
  ran.length = 0;
  yield* Effect.promise(() => Fs.writeFile(tokenFile, "good-token\n"));

  return { home, tokenFile };
});

/** The `default` profile's env and effort, as the profiles Plugin stored them. */
const defaultProfile = (home: string) => {
  const db = new Database(NodePath.join(home, "caw.db"), { readonly: true });

  const row = db
    .query<{ env_json: string; effort: string | null }, []>(
      "select env_json, effort from plugin_profiles_profiles where name = 'default'",
    )
    .get();

  db.close();

  return {
    env: Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
    )(row?.env_json),
    effort: row?.effort,
  };
};

const pluginsTable = (home: string) => {
  const db = new Database(NodePath.join(home, "caw.db"), { readonly: true });
  const rows = db.query('select name, enabled from plugins order by "order"').all();

  db.close();

  return rows;
};

describe("caw install", () => {
  it.live("sets Caw up from flags alone and starts it at login", () =>
    Effect.gen(function* () {
      const { home, tokenFile } = yield* freshHome;

      yield* Effect.promise(() => Fs.writeFile(NodePath.join(home, ".env"), "# mine\nOTHER=1\n"));

      yield* caw(home, [
        "install",
        "--yes",
        "--discord-token-file",
        tokenFile,
        "--model",
        "sonnet",
        "--effort",
        "high",
        "--settings-sources",
        "user,local",
        "--plugins",
        "memory,profiles",
      ]);

      const plist = NodePath.join(home, "Library", "LaunchAgents", "caw.plist");

      expect(printed).toEqual([
        "Caw setup",
        "Channel: Discord",
        `Discord bot token: read from ${tokenFile}`,
        "Discord settings checked",
        "Bot: caw-bot",
        "The bot is in no server yet. Add it with:",
        expect.stringContaining(
          "  https://discord.com/oauth2/authorize?client_id=app-1&scope=bot%20applications.commands&permissions=",
        ),
        expect.stringContaining("Turn on the Message Content intent"),
        `Saved DISCORD_TOKEN to ${NodePath.join(home, ".env")}`,
        "Harness: Claude",
        "Claude model: Sonnet",
        "Claude effort: High",
        "Claude Code settings to load: user, local",
        "Claude settings checked",
        expect.stringMatching(/^Claude Code: /),
        `Claude config: ${NodePath.join(home, ".claude")}`,
        "Features: memory, profiles",
        "Saved them as the default profile (caw profile list)",
        "Start Caw at login?: Yes",
        `Wrote ${plist}`,
        "Caw is running (pid 4242)",
        "caw status  check on it",
        "caw guide  what it can do",
        "caw logs -f  follow its log",
        "Caw is set up. Say hello on Discord.",
      ]);
      expect(ran).toEqual([
        "launchctl bootout gui/501/caw",
        `launchctl bootstrap gui/501 ${plist}`,
      ]);

      const env = NodePath.join(home, ".env");

      expect(yield* Effect.promise(() => Fs.readFile(env, "utf8"))).toBe(
        "# mine\nOTHER=1\nDISCORD_TOKEN=good-token\n",
      );
      expect(((yield* Effect.promise(() => Fs.stat(env))).mode & 0o777).toString(8)).toBe("600");

      expect(defaultProfile(home)).toEqual({
        env: { CLAUDE_CONFIG_DIR: NodePath.join(home, ".claude") },
        effort: "high",
      });
      expect(pluginsTable(home)).toEqual([
        { name: "discord", enabled: 1 },
        { name: "claude", enabled: 1 },
        { name: "memory", enabled: 1 },
        { name: "scheduler", enabled: 0 },
        { name: "profiles", enabled: 1 },
      ]);

      const contents = yield* Effect.promise(() => Fs.readFile(plist, "utf8"));

      expect(contents).toContain(`<key>CAW_HOME</key>\n    <string>${home}</string>`);
      expect(contents).toContain(
        "<string>/usr/local/bin/bun</string>\n    <string>/opt/caw/main.ts</string>\n    <string>start</string>",
      );
    }).pipe(Effect.scoped),
  );

  it.live("restarts a running Caw through the service, so it picks up the new settings", () =>
    Effect.gen(function* () {
      const { home, tokenFile } = yield* freshHome;

      yield* caw(home, ["install", "--yes", "--discord-token-file", tokenFile], true);

      expect(ran).toEqual([
        "launchctl bootout gui/501/caw",
        "Shutdown RPC",
        `launchctl bootstrap gui/501 ${NodePath.join(home, "Library", "LaunchAgents", "caw.plist")}`,
      ]);
      expect(printed).toContain("Stopped the running Caw");
      expect(printed).toContain("Caw is running (pid 4242)");
    }).pipe(Effect.scoped),
  );

  it.live("reinstalls over a loaded service, waiting until launchd lets go of it", () =>
    Effect.gen(function* () {
      const { home, tokenFile } = yield* freshHome;

      yield* caw(home, ["install", "--yes", "--discord-token-file", tokenFile], true, true);

      expect(ran).toEqual([
        "launchctl bootout gui/501/caw",
        `launchctl bootstrap gui/501 ${NodePath.join(home, "Library", "LaunchAgents", "caw.plist")}`,
      ]);
      expect(printed).toContain("Caw is running (pid 4242)");
    }).pipe(Effect.scoped),
  );

  it.live("with --no-service, starts Caw in the background and writes no service", () =>
    Effect.gen(function* () {
      const { home, tokenFile } = yield* freshHome;

      yield* caw(home, ["install", "--yes", "--discord-token-file", tokenFile, "--no-service"]);

      expect(ran).toEqual([
        `detached /usr/local/bin/bun /opt/caw/main.ts start CAW_HOME=${home} >> ${NodePath.join(home, "logs", "daemon.out")}`,
      ]);
      expect(printed).toContain("Start Caw at login?: No");
      expect(printed).toContain("Caw is running (pid 4242)");
      expect(
        yield* Effect.promise(() =>
          Fs.access(NodePath.join(home, "Library", "LaunchAgents", "caw.plist")).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("fails with the Plugin's reason when an answer is rejected", () =>
    Effect.gen(function* () {
      const { home, tokenFile } = yield* freshHome;
      const badToken = NodePath.join(home, "bad-token");

      yield* Effect.promise(() => Fs.writeFile(badToken, "bad-token"));

      expect(
        yield* Effect.exit(caw(home, ["install", "--yes", "--discord-token-file", badToken])),
      ).toEqual(Exit.fail(expect.objectContaining({ message: "Discord rejected the bot token." })));
      expect(printed).toContain("Discord settings rejected");
      expect(yield* Effect.exit(caw(home, ["install", "--yes"]))).toEqual(
        Exit.fail(expect.objectContaining({ message: "Pass --discord-token-file." })),
      );
      expect(
        yield* Effect.exit(
          caw(home, [
            "install",
            "--yes",
            "--discord-token-file",
            tokenFile,
            "--settings-sources",
            "user,global",
          ]),
        ),
      ).toEqual(
        Exit.fail(
          expect.objectContaining({
            message: "Unknown setting sources: global. Use any of user, project, local.",
          }),
        ),
      );
      expect(ran).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
