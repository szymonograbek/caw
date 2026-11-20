# Install wizard

`caw install` is the first-run setup. It walks through Channel, Channel config (the Discord token is checked live), Harness and model (written as the `default` profile), feature plugins, and whether to start Caw at login (default yes: writes and loads a launchd agent; no: starts the daemon in the background). It ends with Caw running. Every prompt has a flag, so it also runs non-interactively.

## Sub-features

- `install-flags` is the full setup from flags (what `V setup` runs).
- `install-interactive` is the prompted flow in a TTY.
- `install-bad-token` re-asks after Discord rejects a token.

## How to get to it (user POV)

- Run `caw install` in a terminal.

## Driving it with caw-verify.sh

Preconditions: a fresh `CAW_HOME` (point `CAW_HOME` at a new temp dir for this feature instead of the checkout's `.caw-dev`).

- **Flags.** `CAW_HOME=<tmp> bun packages/cli/src/main.ts install --yes --channel discord --discord-token-file <file> --harness claude --model sonnet --plugins memory,scheduler,profiles --no-service`. Output includes `Bot: <bot name>`, `Servers: <test server name>`, `Saved profile default  harness=claude  model=sonnet`, `Caw is running (pid N)` and `Caw is set up.`, and no Message Content warning (the intent is on). `<tmp>/.env` is mode 600.
- **Interactive.** Run `caw install` in a PTY (`script -q /dev/null bun packages/cli/src/main.ts install`). Pick Discord and paste a fake token: it prints `Discord rejected the bot token.` and asks again. Ctrl-C prints `Setup cancelled.` and exits 1.

## Gotchas

- Always pass `--no-service` on the operator's machine (or answer No): the default installs and loads a launchd agent. Stop the daemon it starts with `CAW_HOME=<tmp> caw stop` afterwards.
- The interactive happy path with the real token has not been driven by hand. The flag path covers the same steps.
