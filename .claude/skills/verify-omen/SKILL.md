---
name: verify-omen
description: Launch this checkout's Omen daemon (Discord Channel + Claude Harness) and drive it the way a person does, by posting in the #smoke Discord channel through the operator's real browser, then prove the result from Discord's REST API and the omen CLI. Use to verify any change to Omen's routing, sessions, plugins, CLI or install wizard end to end, not just in unit tests.
---

# Verify Omen

Omen is a daemon. People talk to it in Discord. The agent behind it is Claude, which controls Omen through the `omen` CLI. You verify a change by doing what a person does: post in `#smoke` and watch Omen's replies, reactions and threads. Then check what it stored with the CLI.

- Discord guild "<test server name>" `$CAW_VERIFY_GUILD_ID`, channel `#smoke` `$CAW_VERIFY_CHANNEL_ID`: <V url>
- Bot: "the bot". Its token lives only in `$OMEN_HOME/.env`. Never print it.
- Helper: `.claude/skills/verify-omen/scripts/omen-verify.sh` (below as `V`). It resolves this checkout's `OMEN_HOME` from `.env.local`, so it never touches `~/.omen`.

## Isolation

One bot token supports one live gateway connection. Two daemons on the same token both answer every message. Before `launch`, make sure no other checkout runs a daemon with this token: ask the operator if `pgrep -fl "cli/src/main.ts start"` shows a process from another path. Never kill a process you did not start. Use `V stop` for this checkout's daemon only.

Per-checkout state lives in `<checkout>/.omen-dev/` (gitignored): `omen.db`, `omen.sock`, `logs/omen.log`, `conversations/` (Workspaces), `bin/omen` (the shim the agent uses), `.env`.

## Launch

1. First time in a checkout, run `V setup <token-file>`. It runs `dev:setup` plus the non-interactive install wizard: Discord, Claude with model `sonnet`, and memory, scheduler and profiles. Ask the operator for the token through the secret tool (file delivery). Expected output: `Bot: the bot`, `Servers: <test server name>`, `Saved profile default  harness=claude  model=sonnet`, `Omen is set up.`
2. Run `V launch`. It starts `omen start` in the background (output in `$OMEN_HOME/start.out`) and returns once `status` shows `discord running`. Ready means every plugin row reads `running`. `start.out` shows `Registered Discord slash commands` then `Omen started`.

## Doctor

`V doctor` is read-only. It reports `OMEN_HOME`, whether the token is present, `omen status` (pid, live Sessions, plugin states), profiles, and the bot name from Discord. Anything other than all five plugins `running` and `default harness=claude model=sonnet` means you should fix it before driving. Run it first whenever something looks off.

## Drive

Post as the operator through `browse` (MCP `mcp__browse__execute`, browser `dia-personal`, logged into Discord). The UI is in Polish, so use DOM handles, not labels:

- Open a tab: `mcp__browse__tabs {action:"new", id:"omen-discord", browser:"dia-personal", keepOpen:true, url:"<V url>"}`.
- Post a message (in `#smoke` or in a thread URL `<V url ><threadId>`):
  ```js
  const box = page.locator('[role="textbox"][data-slate-editor="true"]');
  await box.click(); await page.keyboard.type("[omen e2e N] ..."); await page.keyboard.press("Enter");
  ```
- Read the last messages on screen: `page.$$eval('[id^="message-content-"]', els => els.slice(-4).map(e => e.innerText))`.
- Slash commands (`/new`, `/stop`): type `/new`, wait about 1s for the command picker, then press Enter twice: the first selects the command, the second sends it.
- Prefix every message with `[omen e2e N]` so runs are distinguishable. Wait 15–45s for Claude replies.
- When a thread side panel is open, the page has two composers. Use `.first()` for the channel and `.last()` for the panel.

Read the authoritative result through the bot's REST view. The bot is a different viewer than the browser, so this also proves the message really landed:

- `V threads` lists active threads under `#smoke` as `<id>\t<name>`, newest last. A threaded Room reply creates one named after your message.
- `V messages <channel-or-thread-id> [limit]` prints messages oldest first as `<id>\t<author>\t<reactions>\t<text>`. The operator posts from their own Discord account.
- `V omen <args>` runs any CLI command against this checkout: `status`, `memory export`, `schedule list --all`, `conversation show --conversation <id>`, `plugin list`, `logs`.
- Sessions and Conversations: `sqlite3 "$OMEN_HOME/omen.db" "select id, conversation_id, status, profile from sessions; select id, external_id, parent_id, reply_mode from conversations;"`

The feature map in `features/README.md` holds one recipe per user-facing feature. Drive every entry point it lists for the feature you are proving.

## Evidence

Proof is the user action plus the resulting state plus the side effect:

- A browse screenshot after the reply: `await page.screenshot({ path: "omen-e2e-N.png" })` writes to the browse relay's temp dir and returns the absolute `path`. `mv` that file into `$OMEN_HOME/evidence/`.
- `V messages` output for the thread or channel, showing your message, Omen's reply and any reactions.
- The CLI or SQL view of the stored effect (memory export, schedule list, sessions row).
- On failure: `tail -50 "$OMEN_HOME/logs/omen.log"`. Logs are JSON lines with `plugin`, `sessionId` and `messageId` annotations.

Proof standards: drive the real path (a message typed in Discord, not an RPC or SQL insert). Check side effects alongside what is visible. No mocks: the Channel is real Discord and the Harness is real Claude on the operator's default config. Evidence and logs stay in `$OMEN_HOME` after cleanup.

## Cleanup

- `V stop` stops this checkout's daemon and leaves `.omen-dev/` (db, logs, evidence) in place.
- To reset state, run `V stop`, then `rm -rf "$OMEN_HOME/omen.db"* "$OMEN_HOME/conversations"`, then `V launch`. This keeps `.env`, logs and evidence.
- Close the browse tab you opened (`mcp__browse__tabs {action:"close", tab:"omen-discord"}`).
- Test threads in `#smoke` may stay. They are the channel's purpose.

## Helpers

`V` = `.claude/skills/verify-omen/scripts/omen-verify.sh`. Run it without arguments for usage. Subcommands: `setup <token-file>`, `launch`, `doctor`, `omen <args>`, `threads`, `messages <id> [limit]`, `stop`.
