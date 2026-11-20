import * as NodePath from "node:path";
import type { LoadedPlugin } from "@omen/core/loaded-plugin";
import { OfflineHost } from "@omen/core/offline-host";
import { OmenHome } from "@omen/core/omen-home";
import type { PluginName } from "@omen/sdk/ids";
import type { PluginSetup } from "@omen/sdk/setup";
import { Config, Console, Effect, FileSystem, Option } from "effect";
import { Command, Flag, Prompt } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { CliFailure } from "../cli-failure.ts";
import { Invocation } from "../invocation.ts";
import type { Asking, QuestionFlags } from "./ask.ts";
import { ask, configureWith, flagNameOf } from "./ask.ts";
import type { ServiceFile } from "./service-file.ts";
import { serviceFile } from "./service-file.ts";

type Role = PluginSetup["_tag"];

/** A Plugin that takes part in setup as a `role`. */
interface Candidate<R extends Role> {
  readonly plugin: LoadedPlugin;
  readonly setup: Extract<PluginSetup, { readonly _tag: R }>;
}

const candidates = <R extends Role>(
  plugins: ReadonlyArray<LoadedPlugin>,
  role: R,
): ReadonlyArray<Candidate<R>> =>
  plugins.flatMap((plugin) =>
    Option.match(plugin.setup, {
      onNone: () => [],
      onSome: (setup) => (isRole(setup, role) ? [{ plugin, setup }] : []),
    }),
  );

const isRole = <R extends Role>(
  setup: PluginSetup,
  role: R,
): setup is Extract<PluginSetup, { readonly _tag: R }> => setup._tag === role;

/** The profiles Plugin stores Harness profiles, so the `default` profile is written through it. */
const profilesPlugin = "profiles";

/** One of `options` by name: given, the only one, the first under `--yes`, or picked. */
const pick = <R extends Role>(
  asking: Asking,
  noun: string,
  options: ReadonlyArray<Candidate<R>>,
  given: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const names = options.map(({ plugin }) => plugin.name).join(", ");
    const [first, ...rest] = options;

    if (first === undefined) {
      return yield* new CliFailure({ message: `No installed plugin provides a ${noun}.` });
    }

    if (Option.isSome(given)) {
      const found = options.find(({ plugin }) => plugin.name === given.value);

      return found === undefined
        ? yield* new CliFailure({
            message: `No ${noun} named ${given.value}; choose from ${names}.`,
          })
        : found;
    }

    const chosen =
      rest.length === 0
        ? first
        : yield* ask(
            asking,
            Option.none(),
            Option.some(first),
            `Pass --${noun.toLowerCase()}.`,
            Prompt.Select({
              message: `Pick a ${noun}`,
              choices: options.map((option) => ({ title: option.setup.title, value: option })),
            }),
          );

    yield* Console.log(`${noun}: ${chosen.setup.title}`);

    return chosen;
  });

const splitNames = (text: string): ReadonlyArray<string> =>
  text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

/** Which feature Plugins to enable: `--plugins`, all under `--yes`, or picked (all preselected). */
const pickFeatures = (
  asking: Asking,
  features: ReadonlyArray<LoadedPlugin>,
  given: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const names = features.map((plugin) => plugin.name);

    const chosen = yield* ask(
      asking,
      Option.map(given, splitNames),
      Option.some(names),
      "Pass --plugins.",
      Prompt.MultiSelect({
        message: "Enable feature plugins",
        choices: features.map((plugin) => ({
          title: plugin.name,
          value: plugin.name,
          selected: true,
        })),
      }),
    );

    const unknown = chosen.filter((name) => !names.some((known) => known === name));

    if (unknown.length > 0) {
      return yield* new CliFailure({
        message: `Unknown feature plugins: ${unknown.join(", ")}; choose from ${names.join(", ")}.`,
      });
    }

    return new Set(chosen);
  });

const runAll = (commands: ReadonlyArray<ReadonlyArray<string>>) =>
  Effect.forEach(commands, ([program = "", ...args]) =>
    ChildProcessSpawner.ChildProcessSpawner.use((spawner) =>
      spawner.exitCode(ChildProcess.make(program, args)),
    ).pipe(
      Effect.mapError(
        (error) => new CliFailure({ message: `${program} failed: ${error.message}` }),
      ),
      Effect.filterOrFail(
        (code) => code === 0,
        (code) =>
          new CliFailure({ message: `\`${[program, ...args].join(" ")}\` exited with ${code}.` }),
      ),
    ),
  );

/** Writes the service file, and loads it only on an explicit yes. Returns the next-step lines. */
const installService = (asking: Asking, service: ServiceFile, load: Option.Option<boolean>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(NodePath.dirname(service.path), { recursive: true });
    yield* fs.writeFileString(service.path, service.contents);
    yield* Console.log(`Wrote ${service.path}`);

    const loadIt = yield* ask(
      asking,
      load,
      Option.some(false),
      "",
      Prompt.Confirm({ message: "Load it now, so Omen starts in the background?" }),
    );

    const commands = service.load.map((command) => command.join(" "));

    if (!loadIt) {
      return [`Load the service with: ${commands.join(" && ")}`];
    }

    yield* runAll(service.load);
    yield* Console.log("Loaded the service; Omen is starting in the background.");

    return ["Check it with: omen status"];
  }).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.fail(new CliFailure({ message: `Writing the service failed: ${error.message}` })),
    ),
  );

/**
 * `omen install`, the first-run wizard. Each step lists what the built-in and
 * installed Plugins offer; each question has a flag, so it also runs without a terminal.
 */
export const installCommand = (
  builtins: ReadonlyArray<LoadedPlugin>,
  installed: ReadonlyArray<LoadedPlugin>,
) => {
  const plugins = [...builtins, ...installed];
  const channels = candidates(plugins, "Channel");
  const harnesses = candidates(plugins, "Harness");
  const features = plugins.filter((plugin) => Option.isNone(plugin.setup));

  const questionFlags = Object.fromEntries(
    [...channels, ...harnesses].flatMap(({ plugin, setup }) =>
      setup.questions.map((question) => [
        flagNameOf(question),
        Flag.String(flagNameOf(question)).pipe(
          Flag.optional,
          Flag.withDescription(`${plugin.name}: ${question.message}`),
        ),
      ]),
    ),
  );

  return Command.make(
    "install",
    {
      yes: Flag.Boolean("yes").pipe(
        Flag.withAlias("y"),
        Flag.withDefault(false),
        Flag.withDescription("Never prompt: take the default for anything not given"),
      ),
      channel: Flag.String("channel").pipe(Flag.optional, Flag.withDescription("Channel plugin")),
      harness: Flag.String("harness").pipe(Flag.optional, Flag.withDescription("Harness plugin")),
      plugins: Flag.String("plugins").pipe(
        Flag.optional,
        Flag.withDescription("Comma-separated feature plugins to enable"),
      ),
      service: Flag.Boolean("service").pipe(
        Flag.optional,
        Flag.withDescription("Write a launchd plist or systemd user unit"),
      ),
      loadService: Flag.Boolean("load-service").pipe(
        Flag.optional,
        Flag.withDescription("Load the written service now"),
      ),
      answers: questionFlags,
    },
    (input) =>
      Effect.gen(function* () {
        const offline = yield* OfflineHost;
        const home = yield* OmenHome;
        const invocation = yield* Invocation;
        const asking: Asking = { yes: input.yes };
        const answers: QuestionFlags = input.answers;

        const channel = yield* pick(asking, "Channel", channels, input.channel);

        const channelConfig = yield* configureWith(
          asking,
          answers,
          channel.setup.questions,
          channel.setup.configure,
        );

        yield* Console.log(channelConfig.report.join("\n"));
        yield* offline.saveEnv(channelConfig.env);
        yield* Console.log(`Saved ${Object.keys(channelConfig.env).join(", ")} to ${home.envFile}`);

        const harness = yield* pick(asking, "Harness", harnesses, input.harness);

        const harnessConfig = yield* configureWith(
          asking,
          answers,
          harness.setup.questions,
          harness.setup.configure,
        );

        yield* Console.log(harnessConfig.report.join("\n"));

        const enabledFeatures = yield* pickFeatures(asking, features, input.plugins);

        const choices: ReadonlyArray<readonly [PluginName, boolean]> = [
          ...channels.map(({ plugin }) => [plugin.name, plugin === channel.plugin] as const),
          ...harnesses.map(({ plugin }) => [plugin.name, plugin === harness.plugin] as const),
          ...features.map((plugin) => [plugin.name, enabledFeatures.has(plugin.name)] as const),
        ];

        yield* offline.setEnabled(builtins, choices);

        const profiles = plugins.find((plugin) => plugin.name === profilesPlugin);

        if (profiles === undefined) {
          yield* Console.log("No profiles plugin is installed, so no default profile was saved.");
        } else {
          yield* offline
            .runCommand(profiles, [
              "profile",
              "add",
              "--harness",
              harnessConfig.harness,
              ...Option.match(harnessConfig.model, {
                onNone: () => [],
                onSome: (model) => ["--model", model],
              }),
              ...Option.match(harnessConfig.settingSources, {
                onNone: () => [],
                onSome: (sources) => ["--settings-sources", sources.join(",")],
              }),
              "default",
            ])
            .pipe(Effect.flatMap(Console.log));

          if (!enabledFeatures.has(profiles.name)) {
            yield* Console.log("The profiles plugin is disabled, so Sessions ignore that profile.");
          }
        }

        const target = {
          userHome: yield* Config.String("HOME"),
          omenHome: home.root,
          cli: invocation.cli,
          path: yield* Config.String("PATH").pipe(Config.withDefault("/usr/bin:/bin")),
          userId: invocation.userId,
        };

        const service = serviceFile(invocation.platform, target);

        const nextSteps = yield* Option.match(service, {
          onNone: () => Effect.succeed([`No service manager support on ${invocation.platform}.`]),
          onSome: (file) =>
            Effect.gen(function* () {
              const write = yield* ask(
                asking,
                input.service,
                Option.some(false),
                "",
                Prompt.Confirm({ message: `Install Omen as a background service (${file.path})?` }),
              );

              return write ? yield* installService(asking, file, input.loadService) : [];
            }),
        });

        yield* Console.log(
          [
            "",
            "Omen is set up.",
            `  Channel: ${channel.setup.title}`,
            `  Harness: ${harness.setup.title}`,
            `  Plugins: ${[...enabledFeatures].join(", ") || "none"}`,
            "",
            "Next:",
            ...(nextSteps.length === 0 ? ["  omen start"] : nextSteps.map((line) => `  ${line}`)),
            "  omen guide",
          ].join("\n"),
        );
      }).pipe(
        Effect.catchTags({
          HostFileError: (error) =>
            Effect.fail(new CliFailure({ message: `Saving ${error.path} failed.` })),
          CliCommandError: ({ message }) => Effect.fail(new CliFailure({ message })),
          ConfigError: (error) => Effect.fail(new CliFailure({ message: error.message })),
        }),
      ),
  ).pipe(Command.withDescription("Set Omen up: Channel, Harness, plugins and service"));
};
