import { Option } from "effect";
import type { Memory } from "./memory.ts";
import { scopeLabel } from "./memory.ts";

/** Roughly how many characters of pinned Memories go into a Session's system prompt. */
export const pinnedBudget = 2000;

const opening = "<pinned-memories>\nYour pinned Memories. memory_list shows all of them.";

const closing = "</pinned-memories>";

/** Reserved so the overflow line always fits. */
const overflowAllowance = 120;

const renderEntry = (memory: Memory): string =>
  `#${memory.id} (${scopeLabel(memory.scope)}) ${memory.title}\n${memory.body}`;

const overflowLine = (omitted: number): string =>
  `${omitted} more pinned Memories did not fit; unpin some or read them with memory_read.`;

export interface PinnedPrompt {
  /** The system prompt section, absent when nothing is pinned. */
  readonly section: Option.Option<string>;
  /** Pinned Memories left out because the budget ran out. */
  readonly omitted: number;
}

/**
 * Renders pinned Memories in the given order until the budget runs out. The
 * order is the caller's, so the same Memories always produce the same prompt.
 */
export const renderPinned = (pinned: ReadonlyArray<Memory>): PinnedPrompt => {
  const entryBudget = pinnedBudget - opening.length - closing.length - overflowAllowance;
  const entries: Array<string> = [];
  let used = 0;

  for (const memory of pinned) {
    const entry = renderEntry(memory);
    // Each entry is preceded by a blank line.
    const cost = entry.length + 2;

    if (used + cost > entryBudget) {
      break;
    }

    entries.push(entry);
    used += cost;
  }

  const omitted = pinned.length - entries.length;

  if (pinned.length === 0) {
    return { section: Option.none(), omitted };
  }

  const overflow = omitted > 0 ? [overflowLine(omitted)] : [];

  return {
    section: Option.some([opening, ...entries, ...overflow, closing].join("\n\n")),
    omitted,
  };
};
