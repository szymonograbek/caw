import { Effect, Layer, Option, Schema } from "effect";
import { PluginName } from "@gloaming/sdk/ids";
import { definePlugin, Caw } from "@gloaming/sdk/plugin";
import { claudeHarness } from "./claude-harness.ts";
import { claudeSetup } from "./setup.ts";

const guide = `The \`claude\` Harness runs each Session as one long-lived Claude Agent SDK session (Claude Code), with all permissions bypassed. It runs the Claude Code installed on the host: the \`claude\` on the daemon's \`PATH\`, which must be the Agent SDK's version or newer.

Profile fields it honors:
- \`model\`: the Claude model (for example \`sonnet\` or \`opus\`); unset uses Claude Code's default.
- \`effort\`: the reasoning effort, any of \`low\`, \`medium\`, \`high\`, \`xhigh\`, \`max\`; unset uses \`medium\`.
- \`settingSources\`: which Claude Code settings to load, any of \`user\`, \`project\`, \`local\`; unset loads all three.
- \`env\`: added to the Session's environment, so \`CLAUDE_CONFIG_DIR\` selects another Claude config directory.
- \`cwd\`: the Session's working directory instead of the Workspace.

The daemon does not run in your shell, so it does not see your shell's environment. Set what Claude Code needs from it, such as \`CLAUDE_CONFIG_DIR\` (Claude Code keys its login by config dir), in the profile's \`env\`. \`caw install\` copies \`CLAUDE_CONFIG_DIR\` into the \`default\` profile when it is set.

Each Plugin's tools appear as the MCP server \`caw_<plugin>\`, always loaded.`;

export default definePlugin({
  name: PluginName.make("claude"),
  settings: Schema.Struct({}),
  migrations: [],
  guide: [
    {
      topic: "claude",
      summary: "The Claude Agent SDK Harness and the profile fields it honors",
      body: guide,
    },
  ],
  skillDir: Option.none(),
  setup: claudeSetup,
  layer: () =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const caw = yield* Caw;

        yield* caw.registerHarness(claudeHarness);
      }),
    ),
});
