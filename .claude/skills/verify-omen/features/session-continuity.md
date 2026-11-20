# Session continuity, tools and the omen CLI

Follow-up messages in a thread reach the same Session, so Claude remembers earlier Turns. Within a Turn the agent can use Omen's tools (memory) and run the `omen` CLI from its shell (through `$OMEN_HOME/bin/omen`, which is on its PATH), and it learns the CLI from `omen guide`.

## Sub-features

- `continuity-recall` keeps context across messages in a thread.
- `continuity-memory-tool` saves a Memory with `memory_save`.
- `continuity-cli` runs `omen guide` from the agent's shell.

## How to get to it (user POV)

- Reply inside an Omen thread.

## Driving it with browse + omen-verify.sh

Preconditions: a thread from `threaded-reply.md` whose Session answered `pineapple`.

- **Ask.** In that thread (URL `<V url ><thread id>`), post `[omen e2e N] Save a global memory titled 'favorite fruit' saying my favorite fruit is pineapple. Then run \`omen guide\` in your shell and tell me how many topics it lists. Also: what word did you reply with before?`. Wait about 45s.
- **Reply.** `V messages <thread id> 3` shows a reply confirming memory #K, listing the guide topics (`overview, install, conversation, plugins, discord, claude, memory, schedule, profiles`), and naming `pineapple`.
- **Side effect.** `V omen memory export` prints `### favorite fruit` under `## Global`.

## Gotchas

- Sonnet sometimes miscounts the topics in its prose. Assert the listed names, not its count.
