import { Option } from "effect";

/** Discord's maximum length of one message's content. */
export const DISCORD_MESSAGE_LIMIT = 2000;

const FENCE = "```";

const CLOSING_FENCE = `\n${FENCE}`;

interface Split {
  readonly piece: string;
  readonly rest: string;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** Cuts at the last paragraph break, else the last line break, else hard at `budget`. */
const splitWithin = (text: string, budget: number): Split => {
  for (const separator of ["\n\n", "\n"]) {
    const index = text.lastIndexOf(separator, budget);

    if (index > 0) {
      return { piece: text.slice(0, index), rest: text.slice(index + separator.length) };
    }
  }

  const cut = isHighSurrogate(text.charCodeAt(budget - 1)) ? budget - 1 : budget;

  return { piece: text.slice(0, cut), rest: text.slice(cut) };
};

/** The fence still open after `text`, given the one open before it. Fences are lines starting with ```. */
const openFenceAfter = (text: string, openBefore: Option.Option<string>): Option.Option<string> => {
  let open = openBefore;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith(FENCE)) {
      open = Option.isSome(open) ? Option.none() : Option.some(trimmed);
    }
  }

  return open;
};

/**
 * Splits `text` into messages of at most `limit` characters, in order. It cuts at
 * paragraph breaks first, then line breaks, and hard-splits overlong lines. A code
 * fence open at a cut is closed in that message and reopened (with its language) in
 * the next, so every message renders on its own.
 */
export const chunkMessage = (text: string, limit: number): ReadonlyArray<string> => {
  const chunks: Array<string> = [];
  let remaining = text;
  let openFence = Option.none<string>();

  while (remaining.length > 0) {
    const reopen = Option.match(openFence, { onNone: () => "", onSome: (fence) => `${fence}\n` });

    if (reopen.length + remaining.length <= limit) {
      chunks.push(reopen + remaining);
      break;
    }

    const available = limit - reopen.length;
    const wide = splitWithin(remaining, available);

    const { piece, rest } = Option.isSome(openFenceAfter(wide.piece, openFence))
      ? splitWithin(remaining, available - CLOSING_FENCE.length)
      : wide;

    openFence = openFenceAfter(piece, openFence);
    chunks.push(reopen + piece + (Option.isSome(openFence) ? CLOSING_FENCE : ""));
    remaining = rest;
  }

  return chunks.filter((chunk) => chunk.trim().length > 0);
};
