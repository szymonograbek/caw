import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { fromCommand } from "@gloaming/caw-plugin-sdk/cli-command";
import { HarnessName, ProfileName } from "@gloaming/caw-plugin-sdk/ids";
import { CliCommandError } from "@gloaming/caw-plugin-sdk/plugin";
import { Profile } from "@gloaming/caw-plugin-sdk/profile";
import { ProfileStore } from "./profile-store.ts";

/** The daemon resolves paths, so a relative path would point inside the daemon's own cwd. */
const AbsolutePath = Schema.String.check(
  Schema.isPattern(/^\//, { message: "--cwd must be an absolute path" }),
);

const splitList = (value: string): ReadonlyArray<string> =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const describeProfile = (profile: Profile): string =>
  [
    profile.name,
    `harness=${profile.harness}`,
    ...Option.toArray(Option.map(profile.model, (model) => `model=${model}`)),
    ...Option.toArray(Option.map(profile.effort, (effort) => `effort=${effort}`)),
    ...Option.toArray(Option.map(profile.cwd, (cwd) => `cwd=${cwd}`)),
    ...Option.toArray(
      Option.map(profile.settingSources, (sources) => `settings-sources=${sources.join(",")}`),
    ),
    // Values often hold secrets, so only the names are shown.
    ...(Object.keys(profile.env).length > 0 ? [`env=${Object.keys(profile.env).join(",")}`] : []),
  ].join("  ");

const profileName = Argument.String("name").pipe(Argument.withSchema(ProfileName));

/** `caw profile add | list | remove`. */
export const profileCommand = Effect.gen(function* () {
  const store = yield* ProfileStore;

  const add = Command.make(
    "add",
    {
      name: profileName,
      harness: Flag.String("harness").pipe(
        Flag.withSchema(HarnessName),
        Flag.withDescription("The Harness to run, e.g. claude"),
      ),
      env: Flag.KeyValuePair("env").pipe(
        Flag.withDefault({}),
        Flag.withDescription("An environment variable for the Harness, as K=V (repeatable)"),
      ),
      model: Flag.String("model").pipe(Flag.optional, Flag.withDescription("The model to use")),
      effort: Flag.String("effort").pipe(
        Flag.optional,
        Flag.withDescription("The reasoning effort, e.g. low, medium, high"),
      ),
      cwd: Flag.String("cwd").pipe(
        Flag.withSchema(AbsolutePath),
        Flag.optional,
        Flag.withDescription("An absolute directory that replaces the Workspace as the cwd"),
      ),
      settingSources: Flag.String("settings-sources").pipe(
        Flag.map(splitList),
        Flag.optional,
        Flag.withDescription("Comma-separated Claude setting sources, e.g. user,project"),
      ),
    },
    (input) =>
      Effect.gen(function* () {
        const profile = new Profile(input);
        yield* store.save(profile);
        yield* Console.log(`Saved profile ${describeProfile(profile)}`);
      }),
  ).pipe(Command.withDescription("Create a Harness profile, or replace the one with that name"));

  const list = Command.make("list", {}, () =>
    Effect.gen(function* () {
      const profiles = yield* store.list;
      yield* Console.log(
        profiles.length === 0 ? "No profiles." : profiles.map(describeProfile).join("\n"),
      );
    }),
  ).pipe(Command.withDescription("List Harness profiles"));

  const remove = Command.make("remove", { name: profileName }, ({ name }) =>
    Effect.gen(function* () {
      const removed = yield* store.remove(name);

      yield* removed
        ? Console.log(`Removed profile ${name}.`)
        : Effect.fail(new CliCommandError({ message: `No profile named ${name}.` }));
    }),
  ).pipe(Command.withDescription("Remove a Harness profile"));

  return fromCommand(
    Command.make("profile").pipe(
      Command.withDescription("Manage Harness profiles"),
      Command.withSubcommands([add, list, remove]),
    ),
    "Manage Harness profiles",
  );
});
