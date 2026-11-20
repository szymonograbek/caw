import { Effect, Layer, Option, Schema } from "effect";
import { PluginName } from "@omen/sdk/ids";
import { definePlugin, Omen } from "@omen/sdk/plugin";
import { claudeHarness } from "./claude-harness.ts";
import { claudeSetup } from "./setup.ts";

const guide = `The \`claude\` Harness runs each Session as one long-lived Claude Agent SDK session (Claude Code), with all permissions bypassed. It runs the Claude Code installed on the host: the \`claude\` on the daemon's \`PATH\`, which must be the Agent SDK's version or newer.

Profile fields it honors:
- \`model\`: the Claude model (for example \`sonnet\` or \`opus\`); unset uses Claude Code's default.
- \`settingSources\`: which Claude Code settings to load, any of \`user\`, \`project\`, \`local\`; unset loads all three.
- \`env\`: added to the Session's environment, so \`CLAUDE_CONFIG_DIR\` selects another Claude config directory.
- \`cwd\`: the Session's working directory instead of the Workspace.

Each Plugin's tools appear as the MCP server \`omen_<plugin>\`, always loaded.`;

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
        const omen = yield* Omen;

        yield* omen.registerHarness(claudeHarness);
      }),
    ),
});
