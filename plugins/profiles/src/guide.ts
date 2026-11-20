import type { GuidePage } from "@caw/sdk/plugin";

export const profilesGuide: GuidePage = {
  topic: "profiles",
  summary: "Harness profiles: which Harness, model, effort, env and cwd a Conversation runs with",
  body: `A Harness profile is a named set of Harness settings. Each Conversation uses one;
the \`default\` profile applies when a Conversation sets none, and you can redefine
\`default\` itself. A Session stays bound to the profile it started with.

Commands:
  caw profile add <name> --harness claude [--env K=V ...] [--model <model>]
                          [--effort <effort>] [--cwd <absolute dir>] [--settings-sources user,project,local]
      Creates the profile, or replaces every setting of the one with that name.
      --env is repeatable. --cwd replaces the Workspace as the Sessions' cwd.
      --settings-sources picks which Claude settings files load (default: all three).
  caw profile list
      Shows every profile. Env values are hidden; only their names are listed.
  caw profile remove <name>

Using a profile:
  caw conversation set --profile <name>
      Switches the current Conversation (from CAW_CONVERSATION_ID) to the profile.
      Its next message starts a new Session with the new settings; threads inherit
      the top-level Conversation's profile.

Changing a profile with \`profile add\` affects only Sessions that start afterwards.`,
};
