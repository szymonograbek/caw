# Session control: /new, /stop, profile change

`/new` closes the Conversation's Session, so the next message starts fresh. `/stop` interrupts a running Turn and reacts ⏹️ on that Turn's triggering message. Changing a Conversation's profile makes its next message start a new Session.

## Sub-features

- `control-new` resets the Session.
- `control-stop` interrupts and reacts ⏹️.
- `control-profile` starts a new Session after `omen conversation set --profile`.

## How to get to it (user POV)

- Type `/new` or `/stop` in a Conversation (registered guild slash commands).
- Run `omen conversation set --profile <name>`.

## Driving it with browse + omen-verify.sh

Preconditions: an Omen thread with a Session that has replied at least once.

- **/new.** Type `/new`, wait about 1.5s for the picker, press Enter twice. The bot replies `Started a new session.` Then post `[omen e2e N] Without using any tools: what single word did you reply with earlier in this conversation? If you have no earlier messages, reply exactly: fresh`. The reply is `fresh`.
- **/stop.** Post `[omen e2e N] Without tools, write the numbers from 1 to 400 as English words, one per line.`, wait 4s, then send `/stop` the same way. `V messages <thread id> 6` shows ⏹️ in the reactions column of your message, a `Stopped.` reply, and a partial list that ends well before "four hundred".
- **Profile.** `V omen profile add other --harness claude --model haiku`, then `V omen conversation set --conversation <room id> --profile other`, then post `[omen e2e N] Which Claude model family are you (haiku, sonnet or opus)? Reply with just that one word.` in `#smoke`. The new thread's reply is `haiku`, and `sqlite3 "$OMEN_HOME/omen.db" "select status, profile from sessions order by rowid desc limit 1"` prints `live|other`. Restore with `--profile default`, then `V omen profile remove other`.

## Gotchas

- `/stop` when no Turn runs (for example, Claude moved a long shell command into the background and ended the Turn) replies `Stopped.` without ⏹️. Use a pure-text task to keep a Turn running.
- After an interrupt, the partial text arrives after the `Stopped.` reply.
