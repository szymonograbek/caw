# Inline Reply mode and Forks

In an `inline` Conversation, Omen replies in the channel itself and keeps one Session. When a person opens a thread off a message there, the thread's first message Forks the main Session: the new Session starts from a copy of its history, and the main Session is unaffected.

## Sub-features

- `inline-reply` replies in the channel without opening a thread.
- `inline-fork` makes a person-made thread Fork the main Session.

## How to get to it (user POV)

- Run `omen conversation set --conversation <room id> --reply-mode inline` (the agent can do it from chat too). DMs are always inline.
- Use "Create thread" on a message in an inline channel.

## Driving it with browse + omen-verify.sh

Preconditions: baseline. Find the `#smoke` Conversation id with `sqlite3 "$OMEN_HOME/omen.db" "select id from conversations where external_id='$CAW_VERIFY_CHANNEL_ID'"`.

- **Switch.** `V omen conversation set --conversation <room id> --reply-mode inline`. It prints `Reply mode of … is now inline.`
- **Inline reply.** In `#smoke`, post `[omen e2e N] Remember the code word: walrus. Reply exactly: noted`. `V messages $CAW_VERIFY_CHANNEL_ID 2` ends with `the bot … noted`, and `V threads` shows no new thread.
- **Fork.** Hover that message, click `Więcej` (More), then `Utwórz wątek` (Create thread) in the `[role="menu"]`. The side panel opens. Type in its composer (the last `[role="textbox"][data-slate-editor="true"]`): `[omen e2e N] Without tools: what is the code word I asked you to remember? Reply with just the word.` The thread reply is `walrus`.
- **Stored.** `sqlite3 "$OMEN_HOME/omen.db" "select s.status, s.forked_from_session_id, c.external_id from sessions s join conversations c on c.id=s.conversation_id order by s.rowid desc limit 2"`. The thread's Session has `forked_from_session_id` set to the room's Session.
- **Restore.** `V omen conversation set --conversation <room id> --reply-mode threaded`.

## Gotchas

- Discord's menu labels are Polish in the operator's client. Select the menu item by text `Utwórz wątek` inside `[role="menu"]`.
