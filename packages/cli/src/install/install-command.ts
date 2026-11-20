import type { LoadedPlugin } from "@caw/core/loaded-plugin";
import { OfflineHost } from "@caw/core/offline-host";
import { CawHome } from "@caw/core/caw-home";
import type { PluginName } from "@caw/sdk/ids";
import type { PluginSetup } from "@caw/sdk/setup";
import { SetupQuestion as Question } from "@caw/sdk/setup";
import { Config, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";
import { Invocation } from "../invocation.ts";
import type { Asking, QuestionFlags } from "./ask.ts";
import { ask, configureWith, flagNameOf, splitNames } from "./ask.ts";
import { serviceFile } from "./service-file.ts";
import { Launch, startCaw } from "./start-caw.ts";
import { WizardUi } from "./wizard-ui.ts";

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

/** One of `options` by name: given, the first under `--yes`, or picked from the list. */
const pick = <R extends Role>(
  asking: Asking,
  noun: string,
  options: ReadonlyArray<Candidate<R>>,
  given: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const ui = yield* WizardUi;
    const [first] = options;

    if (first === undefined) {
      return yield* new CliFailure({ message: `No installed plugin provides a ${noun}.` });
    }

    const choices = options.map(({ plugin, setup }) => ({
      value: plugin.name,
      title: setup.title,
      hint: setup.hint,
    }));

    const name = yield* ask(asking, {
      message: noun,
      given,
      fallback: Option.some(first.plugin.name),
      missing: `Pass --${noun.toLowerCase()}.`,
      describe: (value) => choices.find((choice) => choice.value === value)?.title ?? value,
      prompt: ui.select(noun, choices, first.plugin.name),
    });

    const found = options.find(({ plugin }) => plugin.name === name);

    return found === undefined
      ? yield* new CliFailure({
          message: `No ${noun} named ${name}; choose from ${choices.map((choice) => choice.value).join(", ")}.`,
        })
      : found;
  });

/** Which feature Plugins to enable: `--plugins`, all under `--yes`, or picked (all preselected). */
const pickFeatures = (
  asking: Asking,
  features: ReadonlyArray<LoadedPlugin>,
  given: Option.Option<string>,
) =>
  Effect.gen(function* () {
    const ui = yield* WizardUi;
    const names = features.map((plugin) => plugin.name);

    const choices = features.map((plugin) => ({
      value: plugin.name,
      title: plugin.name,
      hint: plugin.guide[0]?.summary,
    }));

    const chosen = yield* ask(asking, {
      message: "Features",
      given: Option.map(given, splitNames),
      fallback: Option.some(names),
      missing: "Pass --plugins.",
      describe: (picked) => picked.join(", ") || "none",
      prompt: ui.multiselect("Features", choices, names),
    });

    const unknown = chosen.filter((name) => !names.some((known) => known === name));

    if (unknown.length > 0) {
      return yield* new CliFailure({
        message: `Unknown feature plugins: ${unknown.join(", ")}; choose from ${names.join(", ")}.`,
      });
    }

    return new Set(chosen);
  });

/**
 * `caw install`, the first-run wizard. Each step lists what the built-in and
 * installed Plugins offer; each question has a flag, so it also runs without a
 * terminal. It ends with Caw running.
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
          Flag.withDescription(
            `${plugin.name}: ${question.message}${Question.$is("MultiChoice")(question) ? " (comma-separated)" : ""}`,
          ),
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
        Flag.withDescription(
          "Start Caw at login with a launchd agent or systemd user unit (default); --no-service starts it only now",
        ),
      ),
      answers: questionFlags,
    },
    (input) =>
      Effect.gen(function* () {
        const ui = yield* WizardUi;
        const offline = yield* OfflineHost;
        const home = yield* CawHome;
        const invocation = yield* Invocation;
        const asking: Asking = { yes: input.yes };
        const answers: QuestionFlags = input.answers;

        yield* ui.intro("Caw setup");

        const channel = yield* pick(asking, "Channel", channels, input.channel);
        const channelConfig = yield* configureWith(asking, answers, channel.setup);

        yield* offline.saveEnv(channelConfig.env);
        yield* ui.lines([
          ...channelConfig.report,
          `Saved ${Object.keys(channelConfig.env).join(", ")} to ${home.envFile}`,
        ]);

        const harness = yield* pick(asking, "Harness", harnesses, input.harness);
        const harnessConfig = yield* configureWith(asking, answers, harness.setup);

        yield* ui.lines(harnessConfig.report);

        const enabledFeatures = yield* pickFeatures(asking, features, input.plugins);

        const choices: ReadonlyArray<readonly [PluginName, boolean]> = [
          ...channels.map(({ plugin }) => [plugin.name, plugin === channel.plugin] as const),
          ...harnesses.map(({ plugin }) => [plugin.name, plugin === harness.plugin] as const),
          ...features.map((plugin) => [plugin.name, enabledFeatures.has(plugin.name)] as const),
        ];

        yield* offline.setEnabled(builtins, choices);

        const profiles = plugins.find((plugin) => plugin.name === profilesPlugin);

        if (profiles === undefined) {
          yield* ui.warn("No profiles plugin is installed, so no default profile was saved.");
        } else {
          yield* offline.runCommand(profiles, [
            "profile",
            "add",
            "--harness",
            harnessConfig.harness,
            ...Object.entries(harnessConfig.env).flatMap(([key, value]) => [
              "--env",
              `${key}=${value}`,
            ]),
            ...Option.match(harnessConfig.model, {
              onNone: () => [],
              onSome: (model) => ["--model", model],
            }),
            ...Option.match(harnessConfig.effort, {
              onNone: () => [],
              onSome: (effort) => ["--effort", effort],
            }),
            ...Option.match(harnessConfig.settingSources, {
              onNone: () => [],
              onSome: (sources) => ["--settings-sources", sources.join(",")],
            }),
            "default",
          ]);

          // The model and settings already show as answers; the full line would wrap past the guide bar.
          yield* ui.lines(["Saved them as the default profile (caw profile list)"]);

          if (!enabledFeatures.has(profiles.name)) {
            yield* ui.warn("The profiles plugin is disabled, so Sessions ignore that profile.");
          }
        }

        const service = serviceFile(invocation.platform, {
          userHome: yield* Config.String("HOME"),
          cawHome: home.root,
          cli: invocation.cli,
          path: yield* Config.String("PATH").pipe(Config.withDefault("/usr/bin:/bin")),
          userId: invocation.userId,
        });

        const launch = yield* Option.match(service, {
          onNone: () =>
            Effect.as(
              ui.warn(
                `Caw cannot start at login on ${invocation.platform}; it runs until you stop it or restart.`,
              ),
              Launch.Now({ previous: Option.none() }),
            ),
          onSome: (file) =>
            ask(asking, {
              message: "Start Caw at login?",
              given: input.service,
              fallback: Option.some(true),
              missing: "",
              describe: (atLogin) => (atLogin ? "Yes" : "No"),
              prompt: ui.confirm("Start Caw at login?", true),
            }).pipe(
              Effect.map((atLogin) =>
                atLogin
                  ? Launch.AtLogin({ service: file })
                  : Launch.Now({ previous: Option.some(file) }),
              ),
            ),
        });

        yield* startCaw(launch);

        yield* ui.outro(`Caw is set up. Say hello on ${channel.setup.title}.`, [
          ["caw status", "check on it"],
          ["caw guide", "what it can do"],
          ["caw logs -f", "follow its log"],
        ]);
      }).pipe(
        Effect.catchTags({
          HostFileError: (error) =>
            Effect.fail(new CliFailure({ message: `Saving ${error.path} failed.` })),
          CliCommandError: ({ message }) => Effect.fail(new CliFailure({ message })),
          ConfigError: (error) => Effect.fail(new CliFailure({ message: error.message })),
        }),
      ),
  ).pipe(Command.withDescription("Set Caw up: Channel, Harness, plugins, then start it"));
};
