import { claudeHarnessName } from "./claude-error.ts";
import { findClaudeExecutable, notInstalled } from "./claude-executable.ts";
import { answer, PluginSetup, SetupError, SetupQuestion } from "@omen/sdk/setup";
import { Effect, Option } from "effect";

const defaultSources = ["user", "project", "local"];
const knownSources = new Set(defaultSources);

const parseSources = (text: string) => {
  const sources = text
    .split(",")
    .map((source) => source.trim())
    .filter((source) => source.length > 0);

  const unknown = sources.filter((source) => !knownSources.has(source));

  return unknown.length > 0
    ? Effect.fail(
        new SetupError({
          message: `Unknown setting sources: ${unknown.join(", ")}. Use any of ${defaultSources.join(", ")}.`,
        }),
      )
    : Effect.succeed(sources);
};

/** The Claude options `omen install` writes into the `default` profile. */
export const claudeSetup: PluginSetup = PluginSetup.Harness({
  title: "Claude (Claude Agent SDK)",
  questions: [
    SetupQuestion.Choice({
      key: "model",
      flag: "model",
      message: "Claude model",
      choices: [
        { value: "default", title: "Claude Code's default" },
        { value: "sonnet", title: "Sonnet" },
        { value: "opus", title: "Opus" },
        { value: "haiku", title: "Haiku" },
      ],
      initial: "default",
    }),
    SetupQuestion.Text({
      key: "settingSources",
      flag: "settings-sources",
      message: "Claude Code settings to load (comma-separated: user, project, local)",
      initial: defaultSources.join(","),
    }),
  ],
  configure: (answers) =>
    Effect.gen(function* () {
      const executable = yield* Effect.fromOption(
        findClaudeExecutable(process.env["PATH"] ?? ""),
      ).pipe(Effect.mapError(() => new SetupError({ message: notInstalled })));

      const model = yield* answer(answers, "model");
      const sources = yield* Effect.flatMap(answer(answers, "settingSources"), parseSources);
      const isDefault = sources.join(",") === defaultSources.join(",");

      return {
        report: [
          `Claude Code: ${executable}`,
          `Model: ${model}`,
          `Settings sources: ${sources.join(", ")}`,
        ],
        harness: claudeHarnessName,
        model: model === "default" ? Option.none() : Option.some(model),
        settingSources: isDefault ? Option.none() : Option.some(sources),
      };
    }),
});
