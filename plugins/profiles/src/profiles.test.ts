import { SqliteClient } from "@effect/sql-sqlite-bun";
import { describe, expect, it } from "@effect/vitest";
import { Array, Effect, Layer, Option, PubSub, Stream } from "effect";
import { HarnessName, ProfileName } from "@caw/sdk/ids";
import type { CliCommand, CliContext, PluginMessage, ProfileLookup } from "@caw/sdk/plugin";
import { Caw, PluginContext } from "@caw/sdk/plugin";
import { Profile } from "@caw/sdk/profile";
import profiles from "./index.ts";

interface Registered {
  readonly commands: Array<CliCommand>;
  readonly lookups: Array<ProfileLookup>;
}

/** Starts the plugin as core would: migrations first, then its layer with a fake Caw. */
const startPlugin = Effect.gen(function* () {
  const registered: Registered = { commands: [], lookups: [] };
  const unused = Effect.die("not used by the profiles plugin");

  const caw = Layer.succeed(Caw)({
    registerChannel: () => unused,
    registerHarness: () => unused,
    registerTool: () => unused,
    registerInterceptor: () => unused,
    registerCliCommand: (command) => Effect.sync(() => registered.commands.push(command)),
    registerProfiles: (lookup) => Effect.sync(() => registered.lookups.push(lookup)),
    events: Stream.empty,
    bus: yield* PubSub.unbounded<PluginMessage>(),
    conversation: () => unused,
    send: () => unused,
    deliverTask: () => unused,
  });

  const pluginContext = Layer.succeed(PluginContext)({
    name: profiles.name,
    get: () => unused,
    set: () => unused,
  });

  yield* Effect.forEach(profiles.migrations, (migration) => migration.run);
  yield* Layer.build(profiles.layer({}).pipe(Layer.provide(Layer.merge(caw, pluginContext))));

  return registered;
});

const sqlite = SqliteClient.layer({ filename: ":memory:" });

const outside: CliContext = { conversationId: Option.none(), cwd: "/" };

const run = (registered: Registered, line: ReadonlyArray<string>) =>
  Array.findFirst(registered.commands, (command) => command.name === "profile").pipe(
    Effect.fromOption,
    Effect.orDie,
    Effect.flatMap((command) => command.run(line, outside)),
  );

describe("profiles plugin", () => {
  it.effect("stores a profile from the CLI and serves it to core's lookup", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      yield* run(registered, [
        "add",
        "work",
        "--harness",
        "claude",
        "--env",
        "CLAUDE_CONFIG_DIR=/home/me/.claude-work",
        "--env",
        "API_KEY=secret",
        "--model",
        "opus",
        "--effort",
        "high",
        "--cwd",
        "/home/me/work",
        "--settings-sources",
        "user, project",
      ]);

      const found = yield* Effect.forEach(registered.lookups, (lookup) =>
        lookup(ProfileName.make("work")),
      );

      expect(found).toEqual([
        Option.some(
          new Profile({
            name: ProfileName.make("work"),
            harness: HarnessName.make("claude"),
            env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work", API_KEY: "secret" },
            model: Option.some("opus"),
            effort: Option.some("high"),
            cwd: Option.some("/home/me/work"),
            settingSources: Option.some(["user", "project"]),
          }),
        ),
      ]);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("replaces every setting when a profile is added again", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      yield* run(registered, [
        "add",
        "work",
        "--harness",
        "claude",
        "--model",
        "opus",
        "--effort",
        "low",
      ]);
      yield* run(registered, ["add", "work", "--harness", "claude"]);

      const found = yield* Effect.forEach(registered.lookups, (lookup) =>
        lookup(ProfileName.make("work")),
      );

      expect(found).toEqual([
        Option.some(
          new Profile({
            name: ProfileName.make("work"),
            harness: HarnessName.make("claude"),
            env: {},
            model: Option.none(),
            effort: Option.none(),
            cwd: Option.none(),
            settingSources: Option.none(),
          }),
        ),
      ]);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("lists profiles without revealing env values", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      yield* run(registered, ["add", "work", "--harness", "claude", "--env", "API_KEY=secret"]);
      yield* run(registered, ["add", "default", "--harness", "claude"]);
      const listed = yield* run(registered, ["list"]);

      expect(listed).toBe("default  harness=claude\nwork  harness=claude  env=API_KEY");
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("removes a profile, and reports one that does not exist", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      yield* run(registered, ["add", "work", "--harness", "claude"]);
      const removed = yield* run(registered, ["remove", "work"]);
      const missing = yield* Effect.flip(run(registered, ["remove", "work"]));

      const found = yield* Effect.forEach(registered.lookups, (lookup) =>
        lookup(ProfileName.make("work")),
      );

      expect(removed).toBe("Removed profile work.");
      expect(missing.message).toBe("No profile named work.");
      expect(found).toEqual([Option.none()]);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect("rejects a relative --cwd and a missing --harness", () =>
    Effect.gen(function* () {
      const registered = yield* startPlugin;

      const relative = yield* Effect.flip(
        run(registered, ["add", "work", "--harness", "claude", "--cwd", "work"]),
      );

      const noHarness = yield* Effect.flip(run(registered, ["add", "work"]));

      expect(relative.message).toContain("--cwd must be an absolute path");
      expect(noHarness.message).toContain("--harness");
    }).pipe(Effect.provide(sqlite)),
  );
});
