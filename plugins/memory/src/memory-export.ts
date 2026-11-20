import { Array, DateTime } from "effect";
import type { Memory } from "./memory.ts";
import { MemoryScope } from "./memory.ts";

const heading = (scope: MemoryScope): string =>
  MemoryScope.match(scope, {
    Global: () => "## Global",
    Conversation: ({ conversationId }) => `## Conversation ${conversationId}`,
  });

const renderMemory = (memory: Memory): string =>
  [
    `### ${memory.title}${memory.pinned ? " (pinned)" : ""}`,
    memory.body,
    `_#${memory.id} · saved ${DateTime.formatIsoDateUtc(memory.createdAt)} · last used ${DateTime.formatIsoDateUtc(memory.lastUsedAt)}_`,
  ].join("\n\n");

const title = "# Omen Memories";

/** All Memories as markdown, one section per scope, in the order given. */
export const exportMarkdown = (memories: ReadonlyArray<Memory>): string => {
  if (!Array.isReadonlyArrayNonEmpty(memories)) {
    return `${title}\n\nNo Memories.`;
  }

  const sections = Array.groupWith(
    memories,
    (left, right) => heading(left.scope) === heading(right.scope),
  ).map((group) =>
    [heading(Array.headNonEmpty(group).scope), ...group.map(renderMemory)].join("\n\n"),
  );

  return [title, ...sections].join("\n\n");
};
