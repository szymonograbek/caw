# Threaded reply

A person posts a top-level message in a `threaded` Room. Omen opens a thread from that message, starts a new Session there, and posts Claude's reply in the thread. A failed Turn reacts ❌ on the message and posts a short error reply.

## Sub-features

- `threaded-open` opens a thread named after the message.
- `threaded-reply` posts each finished text block of the reply in the thread.
- `threaded-fail` reacts ❌ and posts `❌ The Session failed: …` when the Session breaks.

## How to get to it (user POV)

- Post any message in `#smoke` while its Reply mode is `threaded` (the default).

## Driving it with browse + omen-verify.sh

Preconditions: baseline from `README.md`.

- **Post.** Type `[omen e2e N] Reply with exactly the word: pineapple` in `#smoke` (composer `[role="textbox"][data-slate-editor="true"]`, then Enter). Wait about 20s.
- **Thread exists.** Run `V threads`. The last line is a new thread named `[omen e2e N] Reply with exactly the word: pineapple`.
- **Reply.** Run `V messages <thread id> 5`. The last line is from `the bot` with text `pineapple`.
- **Session stored.** Run `sqlite3 "$OMEN_HOME/omen.db" "select status, profile from sessions order by rowid desc limit 1"`. Expect `live|default`.
- **Proof.** Take a browse screenshot of `#smoke` showing the thread preview, plus the `V messages` output.

## Gotchas

- The thread's first message is an empty bot "starter" line in `V messages`. That is Discord's thread-created notice, not a reply.
- Verified 2026-11-20. Before the fix, every tool without parameters broke the Session ("Tool memory_list parameters have no JSON Schema"). A ❌ on a simple prompt means a tool-schema regression: check `logs/omen.log` for `Session broke`.
