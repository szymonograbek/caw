# Scheduler

The agent (or a person with the CLI) creates a Schedule for a Conversation. When it fires, Omen delivers the prompt as a `<task>` Turn, following the Conversation's Reply mode: in a thread or inline Conversation it goes to the main Session, and in a threaded Room it opens a new thread. One-off Schedules disappear after firing.

## Sub-features

- `schedule-agent` has the agent run `omen schedule add` for its own Conversation.
- `schedule-fire-once` delivers a one-off at its time and then removes it.
- `schedule-cli` covers `omen schedule add|list|remove` from a terminal.

## How to get to it (user POV)

- Ask Omen to schedule something in chat.
- Run `omen schedule add --at <ISO> --prompt <text> --conversation <id>` (or `--cron "<expr>"`) in a terminal.

## Driving it with browse + omen-verify.sh

Preconditions: an Omen thread with a live Session.

- **Ask.** In the thread, post `[omen e2e N] Using omen, schedule a one-off task in this conversation for about 1 minute from now whose prompt is: say the single word mango. Confirm when scheduled.`
- **Stored.** `V omen schedule list --all` shows `#K  once  next <time>  conversation <thread conversation id>` with the mango prompt.
- **Fires.** After `<time>`, `V messages <thread id> 2` ends with `the bot … mango`, and `V omen schedule list --all` prints `No Schedules.`

## Gotchas

- The agent rounds the time up to the next minute, so the run can take up to 2 minutes.
- Times print in the host time zone (`Europe/Warsaw` here).
