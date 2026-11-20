import * as Fs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schedule } from "effect";

const main = NodePath.join(import.meta.dirname, "main.ts");

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A fresh `OMEN_HOME` (also `HOME` and the cwd, so no checkout `.env` loads), removed with the scope. */
const temporaryHome = Effect.acquireRelease(
  Effect.promise(() => Fs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "omen-cli-"))),
  (path) => Effect.promise(() => Fs.rm(path, { recursive: true, force: true })),
);

const environment = (home: string, extra: Record<string, string> = {}) => ({
  PATH: process.env["PATH"] ?? "/usr/bin:/bin",
  HOME: home,
  OMEN_HOME: home,
  ...extra,
});

/** Runs the real `omen` binary to completion. */
const omen = (home: string, argv: ReadonlyArray<string>, extra: Record<string, string> = {}) =>
  Effect.promise(async (): Promise<Run> => {
    const child = Bun.spawn([process.execPath, main, ...argv], {
      cwd: home,
      env: environment(home, extra),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      child.stdout.text(),
      child.stderr.text(),
    ]);

    return { code, stdout: stdout.trim(), stderr: stderr.trim() };
  });

/** `omen start` in the background, without a Discord token; killed with the scope. */
const startDaemon = (home: string) =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn([process.execPath, main, "start"], {
          cwd: home,
          env: environment(home),
          stdout: "ignore",
          stderr: "ignore",
        }),
      ),
      (child) => Effect.sync(() => child.kill()),
    );

    yield* omen(home, ["status"]).pipe(
      Effect.filterOrFail((run) => run.code === 0),
      Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
      Effect.orDie,
    );
  });

describe("omen", () => {
  it.live(
    "says the daemon is not running, and still serves the guide without it",
    () =>
      Effect.gen(function* () {
        const home = yield* temporaryHome;

        const status = yield* omen(home, ["status"]);
        const forwarded = yield* omen(home, ["profile", "list"]);
        const guide = yield* omen(home, ["guide"]);
        const page = yield* omen(home, ["guide", "schedule"]);
        const unknownTopic = yield* omen(home, ["guide", "nope"]);

        expect(status).toMatchObject({ code: 1, stderr: `Omen is not running (home ${home}).` });
        expect(forwarded).toMatchObject({
          code: 1,
          stderr: "Omen is not running. Start it with `omen start`.",
        });
        expect(guide.code).toBe(0);

        for (const topic of [
          "overview",
          "install",
          "conversation",
          "plugins",
          "schedule",
          "memory",
        ]) {
          expect(guide.stdout).toMatch(new RegExp(`^  ${topic} `, "m"));
        }

        expect(page.stdout).toMatch(/^schedule: /);
        expect(unknownTopic).toMatchObject({
          code: 1,
          stderr: 'No guide topic "nope". Run `omen guide` to list topics.',
        });
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "forwards commands to a running daemon, which keeps running when a plugin fails",
    () =>
      Effect.gen(function* () {
        const home = yield* temporaryHome;

        yield* startDaemon(home);

        const again = yield* omen(home, ["start"]);
        const status = yield* omen(home, ["status"]);

        const added = yield* omen(home, [
          "profile",
          "add",
          "--harness",
          "claude",
          "--model",
          "sonnet",
          "default",
        ]);

        const disabled = yield* omen(home, ["plugin", "disable", "discord"]);
        const listed = yield* omen(home, ["plugin", "list"]);
        const unknown = yield* omen(home, ["nope"]);

        const outside = yield* omen(home, ["conversation", "show"], {
          OMEN_CONVERSATION_ID: "c-missing",
        });

        const fromShim = yield* Effect.promise(() =>
          Bun.spawn([NodePath.join(home, "bin", "omen"), "status"], {
            cwd: home,
            env: { PATH: "/usr/bin:/bin" },
            stdout: "pipe",
          }).stdout.text(),
        );

        const stopped = yield* omen(home, ["stop"]);
        const after = yield* omen(home, ["status"]);

        expect(again).toMatchObject({ code: 1 });
        expect(again.stderr).toMatch(/^Omen is already running \(pid \d+\)\.$/);
        expect(status.code).toBe(0);
        expect(status.stdout).toMatch(/discord +failed: .*DISCORD_TOKEN/);
        expect(status.stdout).toMatch(/claude +running/);
        expect(added).toMatchObject({
          code: 0,
          stdout: "Saved profile default  harness=claude  model=sonnet",
        });
        expect(disabled.code).toBe(0);
        expect(listed.stdout).toMatch(/^discord +disabled +\(built in\)$/m);
        expect(unknown).toMatchObject({ code: 1, stderr: "Unknown command: nope" });
        expect(outside).toMatchObject({ code: 1, stderr: "No conversation c-missing." });
        expect(fromShim).toMatch(/^Omen is running/);
        expect(stopped).toMatchObject({ code: 0, stdout: "Omen stopped." });
        expect(after.code).toBe(1);
      }).pipe(Effect.scoped),
    30_000,
  );
});
