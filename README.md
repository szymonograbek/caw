<img src="assets/icon.svg" width="64" height="64" alt="">

# caw

Caw lets you talk to Claude Code from Discord. You send a message in a Discord channel or DM, and Claude Code works on your own computer and replies in the chat. Run it at home, then ask it to fix a build, read a file, or remind you of something while you are away from your desk.

Caw runs as a small background daemon. It keeps one Claude Code session per thread, so every conversation keeps its context between messages.

## Read this before you install

Caw gives Claude Code full access to the computer it runs on. Claude Code skips every permission prompt, and Caw has no sandbox. Anyone who can post in a channel that your bot reads can make it run commands on your machine.

Add the bot only to servers and channels where you trust every member. For the reasons behind this design, see [ADR 0001](docs/adr/0001-unsandboxed-trusted-channels.md).

## Before you start

You need:

- macOS or Linux.
- [Bun](https://bun.sh) 1.4.4 or later.
- [Claude Code](https://claude.com/claude-code), installed and signed in, with `claude` on your `PATH`.
- A Discord bot token. To get one, create an application in the [Discord Developer Portal](https://discord.com/developers/applications), add a bot, and turn on **Message Content Intent**.

## Install Caw

1. Install the `caw` command with Bun:

   ```sh
   bun add -g @gloaming/caw
   ```

2. Run the setup wizard:

   ```sh
   caw install
   ```

   The wizard asks for your Discord bot token and checks it with Discord. If the bot is in no server yet, the wizard prints an invite link. It then sets up Claude Code, lets you pick features, and asks whether Caw should start at login.

When the wizard finishes, Caw is running. Post a message in a channel that the bot can read, and Caw replies.

## Talk to Caw

Every message gets a reply. You don't need to mention the bot.

- **In a server channel**, each new message opens a thread, and that thread is its own conversation with Claude Code. Reply inside the thread to continue it.
- **In a DM**, the whole DM is one conversation. To branch off, open a thread on a message. The thread starts with a copy of the conversation so far, and the original stays as it was.
- **To add to a reply in progress**, send another message. Claude Code reads it without starting over.
- **To share a file or an image**, attach it. Caw saves it where Claude Code can open it.

Caw reacts with ❌ when a reply fails, and with ⏹️ when you stop one. Claude Code can also react with an emoji instead of writing a reply.

Two slash commands control a conversation:

| Command | What it does                               |
| ------- | ------------------------------------------ |
| `/new`  | Starts a fresh conversation in this place. |
| `/stop` | Stops the reply in progress.               |

If Claude Code loses a conversation, Caw starts a new one, gives it the recent chat history, and posts a short notice.

## What else Caw can do

Claude Code learns these features by itself, so you can ask for them in the chat. Each one also has a `caw` command.

- **Reminders and recurring tasks.** Ask "every weekday at 9, summarize my open pull requests", and Caw posts the result on schedule. Use `caw schedule add`, `caw schedule list`, and `caw schedule remove` to manage schedules yourself.
- **Memory.** Ask Caw to remember something, and it keeps a short note for this conversation or for all of them. Caw loads pinned notes whenever a conversation starts. Run `caw memory export` to save all notes as Markdown.
- **Profiles.** A profile sets the model, the effort level, the working folder, and environment variables for Claude Code. Create one with `caw profile add`, then use it in a conversation with `caw conversation set --profile <name>`.

Each channel and each DM gets its own working folder in `~/.caw/conversations/`, and its threads share that folder. A profile can set a different folder.

## Manage the daemon

| Command                 | What it does                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `caw status`            | Shows whether Caw is running, its live sessions, and its plugins.                           |
| `caw start`, `caw stop` | Starts or stops the daemon.                                                                 |
| `caw logs -f`           | Follows the log.                                                                            |
| `caw guide`             | Lists help topics. `caw guide <topic>` explains one.                                        |
| `caw plugin list`       | Lists plugins. Use `add`, `remove`, `enable`, `disable`, `order`, and `set` to change them. |

Caw keeps everything in `~/.caw`: the database, your bot token in `.env`, the conversation folders, and the logs. To move Caw to another machine, copy that folder. To use a different folder, set `CAW_HOME`.

Caw sends no telemetry. Logs stay in `~/.caw/logs/caw.log`.

## Extend Caw

Discord, Claude Code, memory, schedules, and profiles are all plugins. You can write your own plugin to add a chat platform, an agent, a tool, or a command. Install a plugin with `caw plugin add <git-url | npm-name | path>`.

To learn how Caw works inside, read the [spec](docs/spec.md) and the [glossary](GLOSSARY.md).

## Develop Caw

To run Caw from source, clone the repository, run `bun install`, then `bun run install:global` to build `caw` and copy it into Bun's global bin folder. Run `bun run dev:setup` once per checkout. It points `CAW_HOME` at `.caw-dev/` in the checkout, so a development daemon never touches `~/.caw`. Run `bun run verify` before you open a pull request. [AGENTS.md](AGENTS.md) lists the project's conventions.
