import { claudeHarnessName } from "./claude-error.ts";
import { findClaudeExecutable, notInstalled } from "./claude-executable.ts";
import { answer, answerList, PluginSetup, SetupError, SetupQuestion } from "@omen/sdk/setup";
import { Config, Effect, Option } from "effect";

const knownSources = ["user", "project", "local"];

/** The known sources among `sources`, in Claude Code's order. */
const checkSources = (sources: ReadonlyArray<string>) => {
  const unknown = sources.filter((source) => !knownSources.includes(source));

  return unknown.length > 0
    ? Effect.fail(
        new SetupError({
          message: `Unknown setting sources: ${unknown.join(", ")}. Use any of ${knownSources.join(", ")}.`,
        }),
      )
    : Effect.succeed(knownSources.filter((source) => sources.includes(source)));
};

/** The Claude options `omen install` writes into the `default` profile. */
export const claudeSetup: PluginSetup = PluginSetup.Harness({
  title: "Claude",
  hint: "Claude Code through the Claude Agent SDK",
  questions: [
    SetupQuestion.Choice({
      key: "model",
      flag: "model",
      message: "Claude model",
      choices: [
        { value: "default", title: "Claude Code's default", hint: "whatever Claude Code picks" },
        { value: "sonnet", title: "Sonnet", hint: "fast and capable" },
        { value: "opus", title: "Opus", hint: "most capable" },
        { value: "haiku", title: "Haiku", hint: "fastest" },
      ],
      initial: "default",
    }),
    SetupQuestion.Choice({
      key: "effort",
      flag: "effort",
      message: "Claude effort",
      choices: [
        { value: "low", title: "Low", hint: "fastest, least thinking" },
        { value: "medium", title: "Medium", hint: "balanced" },
        { value: "high", title: "High", hint: "more thinking" },
        { value: "xhigh", title: "Extra high", hint: "deeper thinking" },
        { value: "max", title: "Max", hint: "most thinking, slowest" },
      ],
      initial: "medium",
    }),
    SetupQuestion.MultiChoice({
      key: "settingSources",
      flag: "settings-sources",
      message: "Claude Code settings to load",
      choices: [
        { value: "user", title: "user", hint: "~/.claude" },
        { value: "project", title: "project", hint: ".claude/ in the working directory" },
        { value: "local", title: "local", hint: ".claude/settings.local.json" },
      ],
      initial: knownSources,
    }),
  ],
  configure: (answers) =>
    Effect.gen(function* () {
      const executable = yield* Effect.fromOption(
        findClaudeExecutable(process.env["PATH"] ?? ""),
      ).pipe(Effect.mapError(() => new SetupError({ message: notInstalled })));

      const model = yield* answer(answers, "model");
      const effort = yield* answer(answers, "effort");
      const sources = yield* Effect.flatMap(answerList(answers, "settingSources"), checkSources);

      // Claude Code keys its login by config dir: without this one the daemon's Sessions are logged out.
      const configDir = yield* Config.option(Config.String("CLAUDE_CONFIG_DIR")).pipe(
        Effect.mapError((error) => new SetupError({ message: error.message })),
      );

      return {
        report: [
          `Claude Code: ${executable}`,
          ...Option.toArray(Option.map(configDir, (dir) => `Claude config: ${dir}`)),
        ],
        env: Option.match(configDir, {
          onNone: () => ({}),
          onSome: (dir) => ({ CLAUDE_CONFIG_DIR: dir }),
        }),
        harness: claudeHarnessName,
        model: model === "default" ? Option.none() : Option.some(model),
        effort: Option.some(effort),
        settingSources:
          sources.length === knownSources.length ? Option.none() : Option.some(sources),
      };
    }),
});
