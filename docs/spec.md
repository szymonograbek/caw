# Omen — v1 spec

Terms are defined in [GLOSSARY.md](../GLOSSARY.md). Key decisions are in [docs/adr](./adr).

## Goal

A minimal daemon that lets trusted people talk to agent Harnesses (Claude Agent SDK first) through Channels (Discord first). Core stays small; everything else, including Discord and Claude, is a Plugin.

## Architecture

- **Core**: daemon lifecycle, Channel and Harness interfaces, sqlite store, routing, plugin SDK (Events + Interceptors), CLI RPC, Guide.
- **Built-in plugins**: `discord`, `claude`, `memory`, `scheduler`, `profiles`.
- **Repo**: Bun workspaces monorepo.
  - `packages/sdk` — public plugin API (types, Event union, Interceptor types, services). The only thing plugins import.
  - `packages/core` — daemon, store, routing, RPC.
  - `packages/cli` — the `omen` binary.
  - `plugins/*` — built-in plugins.
- **Stack**: Bun, Effect v4. Distributed as an npm package (`bun add -g omen`), or compiled into a single `omen` binary (`bun run install:global`). Omen runs the Claude Code installed on the host (`claude` on `PATH`), not a bundled copy.
- **State**: everything under `~/.omen/` (DB, plugins, Workspaces, logs, `.env`), so migrating machines is a folder copy.

## Conversations and Sessions

### Reply mode

Configured per Conversation:

- `threaded` (default for guild channels): each top-level message makes Omen open a thread; that thread is a new Session.
- `inline` (always for DMs): the Conversation is one Session; replies go in the main chat. A thread a person opens off a message Forks the main Session into a new one.

Every message triggers a reply; no mention is needed. `/new` resets the Conversation's Session. `/stop` interrupts the current Turn.

### Hierarchy

A thread is a child Conversation. Workspace, Harness profile, and Memory belong to the top-level Conversation and are inherited by threads (required for Forks: same cwd and config dir).

### Live Sessions

- One long-lived streaming `query()` per active Session.
- Closed after 10 min idle (configurable). The next message resumes by cursor.
- Max 5 live (configurable); the least recently used one is closed first.
- A message arriving mid-Turn is a Steer: it is pushed into the live query.

### Harness profile binding

A Session is permanently bound to the Harness profile it started with. Changing a Conversation's profile makes its next message start a new Session.

### Lost Session recovery

The Harness's "conversation not found" error maps to a typed error. Omen then:

1. Marks the Session `lost`.
2. Starts a new Session whose first input includes a `<channel-history>` block with the last ~50 Channel messages.
3. Posts a one-line notice in the Conversation.

## Message flow

### Inbound (to the Harness)

The format follows NanoClaw:

```
<context timezone="Europe/Warsaw"/>
<message id="…" sender="Name" time="Nov 20, 2026, 9:12 AM" reply_to="…">
  <quoted_message from="X">…</quoted_message>
text
[image: foo.png — saved to <workspace>/inbox/<msgId>/foo.png]
</message>
```

- Multiple messages are newline-joined, with no outer wrapper.
- Attachments are saved to the Workspace `inbox/` and referenced by path, not sent as image blocks.
- Scheduled runs arrive as `<task current_time="…">` blocks.
- Volatile data (time, author) lives in the Turn, never in the system prompt.

### Outbound (to the Channel)

- Each finished assistant text block is posted as a message, chunked to 2000 chars. No streaming edits.
- A typing indicator is refreshed while a Turn runs.
- Tool calls are hidden; a plugin can surface them.
- Reactions:
  - The Discord plugin exposes a `react(messageId, emoji)` tool with a configurable allowed list (default 👀 ✅ 👍 ❤️ 😂 🤔 🎉 ⚠️).
  - A Turn may end with a reaction only.
  - ❌ (Turn failed, plus a short error reply) and ⏹️ (`/stop`) are set automatically on the triggering messages.

## Harness interface

```
open(session: New | Resume(cursor) | Fork(cursor)) → LiveSession
LiveSession: send(message), interrupt(), close(), events: Stream<HarnessEvent>
HarnessEvent: Text | ToolCall | ToolResult | TurnEnded | Error | CursorUpdated
```

- Tools arrive Harness-agnostic (Effect Schema params plus an Effect handler). Each Harness maps them; Claude uses one in-process MCP server per plugin (`omen_<plugin>`), always loaded (never deferred).
- Each Harness decodes its opaque `resume_cursor_json` with its own Schema at the boundary.

### Claude Harness specifics

- `permissionMode: bypassPermissions` everywhere (ADR 0001).
- `settingSources` come from the profile; the default is `['user','project','local']`.
- The system prompt is the `claude_code` preset plus a short fixed Omen append. It tells the agent:
  - it is Omen, talking through `<Channel>`;
  - to write Discord markdown;
  - to run `omen guide` to learn its controls.

  `snapshot` stays at its default so the prompt is stable for the Session's lifetime.
- `env` is `process.env` plus the profile env plus `OMEN_CONVERSATION_ID` and `OMEN_SESSION_ID`.
- Omen's core skill and plugin skill directories are passed as a local Claude plugin.

## Prompt caching rules

- The system prompt and tool set are fixed for a live Session's lifetime.
- Plugin contributions to the prompt or tools are collected once, at `SessionOpening`.
- Plugin toggles and setting changes:
  - Hook-only changes apply immediately.
  - Tool and prompt changes close live Sessions; they resume on their next message, costing one cache miss each.
- Nothing volatile goes in the system prompt.

## Plugin system

- A plugin is a default-exported Effect `Layer`. Its scope is the plugin's lifetime: disabling it closes the scope, which cancels subscriptions and runs finalizers.
- **Events** (observe only):
  - Core publishes every event (daemon, Channel messages, Conversation, Session, Turn, all Harness events, replies) as a tagged `OmenEvent` union on a `PubSub`.
  - Plugins consume them as a `Stream`.
  - Each subscriber has its own queue, so slow plugins never block core.
- **Interceptors** (change the flow): an ordered chain per interception point. Core folds through the chain and stops at the first `drop`, `handled`, or `block`.

  | Point | Results |
  |---|---|
  | `InboundMessage` | `continue \| transform \| drop \| handled` |
  | `SessionOpening` | adds system prompt, tools, env |
  | `TurnInput` | transform what is sent to the Harness |
  | `ToolCall` | `allow \| block \| mutate` (Claude: mapped from PreToolUse) |
  | `OutboundReply` | `continue \| transform \| drop` |

- **Services from Context**:
  - registration of `tool`, `channel`, `harness`, `cliCommand`, `guidePage`, and `skillDir`;
  - `send(conversation, message)`;
  - `store`;
  - an inter-plugin event bus.
- **No guard rails** beyond typing; plugins may break things.
- **Order**: install order by default, changed with `omen plugin order`.
- **Package**: a default export plus an `omen` key in `package.json` (name, version, settings schema).
- **Install**: `omen plugin add <git-url | npm-name | path>` installs into `~/.omen/plugins/<name>/` and runs `bun install`. Built-ins ship inside Omen and are enabled by default.
- **Storage**: plugins can own tables `plugin_<name>_*` in the core DB, with migrations core runs, or use a key-value `store.get/set`.

## Persistence

- sqlite at `~/.omen/omen.db`.
- Pragmas: `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`.
- Effect `Migrator` with numbered, idempotent migration modules. Branded ids.

| Table | Contents |
|---|---|
| `conversations` | id, channel, external_id, parent_id, reply_mode, profile, settings |
| `sessions` | id, conversation_id, harness, profile, status (`live \| idle \| lost \| closed`), resume_cursor_json, runtime_payload_json, forked_from_session_id, last_seen_at |
| `message_map` | channel_message_id → conversation_id, session_id |
| `plugins` | name, source, version, enabled, order, settings_json |
| `plugin_kv` | plugin, key, value_json |

There is no event log, projection, or message table: the Channel is the history.

## Control surface (ADR 0002)

- The `omen` CLI is the only control surface. It talks to the daemon over RPC on `~/.omen/omen.sock`.
- `start`, `install`, `guide`, and `plugin add` work without a running daemon.
- The agent uses the same CLI through its shell. A tiny core skill tells it to run `omen guide`. `omen guide` lists topics; `omen guide <topic>` explains one. Plugins add pages.
- The current Conversation is resolved from `OMEN_CONVERSATION_ID`.
- Commands:
  - `start | stop | status | install`
  - `install` is the first-run setup wizard. Each step lists what installed plugins offer, never a hardcoded menu:
    1. Pick a Channel (Discord today) and enter its config. The Discord bot token is checked live and saved to `~/.omen/.env`. If the bot is in no server, the wizard prints an invite URL.
    2. Pick a Harness (Claude today) and its options. These become the `default` Harness profile.
    3. Pick which feature plugins to enable.
    4. Ask whether to start Omen at login (default yes). Yes writes and loads a launchd plist (macOS first) or a systemd user unit; no starts the daemon in the background now. Either way Omen is running when the wizard ends, restarted if it already ran.

    Every prompt has a flag, so `install` also runs non-interactively. Plugins take part through an optional `setup` in their definition.
  - `logs [-f]`
  - `guide [topic]`
  - `plugin add | remove | enable | disable | order | list | set`
  - `profile add | list | remove`
  - `conversation set | show`
  - `schedule add | list | remove`
  - `memory export`
- Logs are structured JSON in `~/.omen/logs/omen.log`. No telemetry.

## Built-in plugins

### discord

- Channel implementation: guild channels, threads, and DMs.
- Reply mode handling, typing indicator, 2000-char chunking.
- The `react` tool and automatic ❌ / ⏹️.
- Bot token comes from env (`~/.omen/.env`).

### claude

The Claude Agent SDK Harness (see above).

### profiles

- `omen profile add <name> --harness claude --env K=V … [--model] [--cwd] [--settings-sources]`.
- `omen conversation set --profile <name>`.
- A `default` profile applies when none is set.
- The profile's cwd overrides the Workspace default.

### memory (ADR 0003)

- Rows: scope (`global | conversation`), title, body, pinned, created_at, last_used_at.
- Tools: `memory_save`, `memory_update`, `memory_forget`, `memory_list` (titles only), `memory_read`, `memory_pin`.
- Pinned Memories are injected at `SessionOpening` within a ~2000-char budget.
- Hard caps: 100 per scope, 1000 chars each. A save over a cap is rejected and the agent is told to merge or forget. No auto-eviction.
- `omen memory export` writes markdown.

### scheduler

- A Schedule is a cron expression or a one-off time, plus a target Conversation and a prompt. It is created via `omen schedule add` (by the user or the agent).
- When it fires, it is delivered as a `<task>` message following the Conversation's Reply mode: a new thread when `threaded`, the main Session when `inline`.
- Missed runs: at most one catch-up per Schedule, and only if the missed run was due within the last 24h.

## Workspace

- Default `~/.omen/conversations/<top-level-id>/`: the Sessions' cwd, the Conversation's CLAUDE.md, and `inbox/`.
- Overridable by the profile's cwd.

## Security (ADR 0001)

- No sandbox, `bypassPermissions` everywhere, no allowlist.
- The trust boundary is Channel membership: only trusted people are present.
