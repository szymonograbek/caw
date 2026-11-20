import type { GuidePage } from "@caw/sdk/plugin";
import { maxBodyLength, memoriesPerScope } from "./memory.ts";
import { pinnedBudget } from "./pinned-memories.ts";

export const memoryGuide: GuidePage = {
  topic: "memory",
  summary: "Memories: short durable facts you save, pin and look up across Sessions",
  body: `A Memory is a short, durable fact: a preference, a decision, where something lives.
Memories outlive Sessions. Save them with your memory tools, not in files.

Scopes:
  conversation  This top-level Conversation and all of its threads.
  global        Every Conversation.

Tools:
  memory_save    Save a Memory (scope, title, body, optional pinned).
  memory_list    Ids and titles of every Memory visible here.
  memory_read    One Memory's full body.
  memory_update  Change a title or body; use it to merge Memories.
  memory_forget  Delete a Memory.
  memory_pin     Pin or unpin a Memory.

Pinned Memories are added to the system prompt of every new Session, within a
${pinnedBudget}-character budget; Sessions already running keep their prompt. Pin only
what you need every time and look the rest up with memory_list and memory_read.

Caps: ${memoriesPerScope} Memories per scope, ${maxBodyLength} characters per body. A save past a cap
fails; merge related Memories with memory_update or forget stale ones, then retry.
Nothing is evicted automatically.

CLI:
  caw memory export [--out <absolute file>]
      Writes every Memory as markdown, to stdout or to the file.`,
};
