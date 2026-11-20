# Install wizard

`omen install` is the first-run setup. It walks through Channel, Channel config (the Discord token is checked live), Harness and model (written as the `default` profile), feature plugins, and an optional service file (loaded only on a separate yes). Every prompt has a flag, so it also runs non-interactively.

## Sub-features

- `install-flags` is the full setup from flags (what `V setup` runs).
- `install-interactive` is the prompted flow in a TTY.
- `install-bad-token` re-asks after Discord rejects a token.

## How to get to it (user POV)

- Run `omen install` in a terminal.

## Driving it with omen-verify.sh

Preconditions: a fresh `OMEN_HOME` (point `OMEN_HOME` at a new temp dir for this feature instead of the checkout's `.omen-dev`).

- **Flags.** `OMEN_HOME=<tmp> bun packages/cli/src/main.ts install --yes --channel discord --discord-token-file <file> --harness claude --model sonnet --plugins memory,scheduler,profiles`. Output includes `Bot: the bot`, `Servers: <test server name>`, `Saved profile default  harness=claude  model=sonnet` and `Omen is set up.`, and no Message Content warning (the intent is on). `<tmp>/.env` is mode 600.
- **Interactive.** Run `omen install` in a PTY (`script -q /dev/null bun packages/cli/src/main.ts install`). Pick Discord and paste a fake token: it prints `Discord rejected the bot token.` and asks again. Ctrl-C prints `Setup cancelled.` and exits 1.

## Gotchas

- Never run the service step with `--load-service` on the operator's machine without asking. It installs a launchd agent.
- The interactive happy path with the real token has not been driven by hand. The flag path covers the same steps.
