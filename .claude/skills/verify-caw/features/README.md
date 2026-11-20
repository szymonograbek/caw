# Caw verification map

This directory is the maintained source for verifying Caw's user-facing behavior. Read `../SKILL.md` first, then use the matching feature file as the recipe.

## Baseline preconditions

- This checkout's daemon is running: `V launch`, then `V doctor` shows all five plugins `running` and `default  harness=claude  model=sonnet`.
- No other checkout's daemon uses the same bot token.
- A browse tab `caw-discord` on `#smoke` in the `dia-personal` browser.
- `#smoke` is a `threaded` Room (the default). Check with `V caw conversation show --conversation <room id>` when a recipe depends on it.

## Driving conventions

- Post as the operator through browse. Read results through `V messages` / `V threads` and the CLI.
- Prefix every message with `[caw e2e N]`, with N unique within the run.
- Keep prompts tiny and deterministic ("reply with exactly …") to limit cost and make assertions exact.
- Restore settings you change (`reply-mode`, profiles, plugins) at the end of the recipe.

## Proof and skip reporting

- Capture the message you posted, Caw's reply or reaction, and the stored side effect.
- Report an entry point you could not reach with the attempt and the unmet precondition. Never report it as verified through a different path.

## Features

| File | Feature |
| --- | --- |
| [threaded-reply.md](threaded-reply.md) | A Room message opens a thread with a new Session and Caw replies there |
| [session-continuity.md](session-continuity.md) | Follow-ups in a thread reuse the Session; memory tool and `caw` CLI from the agent's shell |
| [scheduler.md](scheduler.md) | The agent schedules a task; it fires as a `<task>` Turn |
| [session-control.md](session-control.md) | `/new`, `/stop`, failed Turn ❌, profile change |
| [inline-and-fork.md](inline-and-fork.md) | `inline` Reply mode; a person-made thread Forks the main Session |
| [install-wizard.md](install-wizard.md) | `caw install` interactive and flag-driven setup |
