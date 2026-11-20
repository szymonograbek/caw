import type { GuidePage } from "@omen/sdk/plugin";

const overview: GuidePage = {
  topic: "overview",
  summary: "What Omen is, how you control it, and every command group",
  body: `Omen is a daemon that lets trusted people talk to agent Harnesses (Claude first)
through Channels (Discord first). Everything beyond the core is a Plugin.

You control Omen with the \`omen\` CLI, from a terminal or from the agent's shell.
Inside a Session your shell already has OMEN_CONVERSATION_ID, so commands that
take --conversation default to the Conversation you are in.

Commands:
  omen install                  First-run setup: Channel, Harness, plugins, service
  omen start | stop | status    Run the daemon in the foreground, stop it, check it
  omen logs [-f]                Print (or follow) the daemon's JSON log
  omen guide [topic]            List topics, or read one
  omen plugin ...               Install, enable, order and configure plugins
  omen conversation set | show  A Conversation's profile and Reply mode
  omen profile ...              Harness profiles (profiles plugin)
  omen schedule ...             Prompts delivered on a schedule (scheduler plugin)
  omen memory ...               Saved Memories (memory plugin)

Run \`omen guide\` for every topic, and \`omen <command> --help\` for flags.`,
};

const conversation: GuidePage = {
  topic: "conversation",
  summary: "Conversations, threads and Sessions; changing a profile or Reply mode",
  body: `A Conversation is a Discord channel, thread or DM. A thread is a child
Conversation: it inherits the Workspace, Harness profile and Memory of its
top-level Conversation, so settings always live on the top-level one.

Reply mode:
  threaded  Each top-level message opens a thread, which is a new Session
            (default for server channels).
  inline    The Conversation is one Session; replies go in the main chat. A thread
            a person opens off a message Forks the main Session (always for DMs).

Commands:
  omen conversation show [--conversation <id>]
      The Conversation's Reply mode, profile and current Session.
  omen conversation set [--conversation <id>] [--profile <name>]
                        [--reply-mode threaded|inline]
      A Session stays bound to the profile it started with, so after a profile
      change the next message starts a new Session.

--conversation defaults to OMEN_CONVERSATION_ID.`,
};

const plugins: GuidePage = {
  topic: "plugins",
  summary: "Installing, enabling, ordering and configuring plugins",
  body: `Discord, Claude, memory, scheduler and profiles are built-in plugins. Others are
packages with an "omen" key in their package.json.

Commands:
  omen plugin list
      Every plugin in plugin order, with its state (running, failed, disabled).
  omen plugin add <git-url | npm-name | path>
      Installs into <home>/plugins/<name>/ and enables it. Works without a daemon.
  omen plugin remove <name>          Uninstalls a plugin (built-ins can only be disabled)
  omen plugin enable | disable <name>
  omen plugin order <name> [<name> ...]
      Moves the named plugins to the front. Order decides who sees a message first.
  omen plugin set <name> <key>=<value> [...]
      Changes settings. A value that parses as JSON is JSON, e.g.
      omen plugin set discord 'allowedReactions=["👀","✅"]'

Enabling, disabling, ordering or configuring a plugin closes live Sessions, since
their tools and system prompt are fixed while they run; each resumes on its next
message.`,
};

const install: GuidePage = {
  topic: "install",
  summary: "First-run setup with omen install, interactively or with flags",
  body: `\`omen install\` sets Omen up without a running daemon:
  1. Pick a Channel and enter its config. A Discord bot token is checked live and
     saved to <home>/.env; if the bot is in no server, an invite URL is printed.
  2. Pick a Harness and its options; they become the \`default\` profile.
  3. Pick which feature plugins to enable.
  4. Optionally write a launchd plist (macOS) or systemd user unit, and load it.

Every question has a flag, so it runs without a terminal:
  omen install --yes --channel discord --discord-token-file <path> \\
    --harness claude --model sonnet --plugins memory,scheduler,profiles \\
    --service --no-load-service
--yes takes the default for anything not given; a secret has no default.
Run \`omen install --help\` for every flag.`,
};

/** Core's own `omen guide` pages, listed before every Plugin's. */
export const coreGuide: ReadonlyArray<GuidePage> = [overview, install, conversation, plugins];
