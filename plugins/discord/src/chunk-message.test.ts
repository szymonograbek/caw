import { describe, expect, it } from "@effect/vitest";
import { chunkMessage, DISCORD_MESSAGE_LIMIT } from "./chunk-message.ts";

const fenceLines = (chunk: string): number =>
  chunk.split("\n").filter((line) => line.trim().startsWith("```")).length;

describe("chunkMessage", () => {
  it("keeps a message that fits as one chunk", () => {
    expect(chunkMessage("hello\n\nworld", DISCORD_MESSAGE_LIMIT)).toEqual(["hello\n\nworld"]);
  });

  it("sends nothing for blank text", () => {
    expect(chunkMessage("", DISCORD_MESSAGE_LIMIT)).toEqual([]);
    expect(chunkMessage("  \n ", DISCORD_MESSAGE_LIMIT)).toEqual([]);
  });

  it("prefers a paragraph break over a later line break", () => {
    const text = "first para\n\nsecond line one\nsecond line two";

    expect(chunkMessage(text, 35)).toEqual(["first para", "second line one\nsecond line two"]);
  });

  it("falls back to a line break when there is no paragraph break", () => {
    expect(chunkMessage("aaaa\nbbbb\ncccc", 10)).toEqual(["aaaa\nbbbb", "cccc"]);
  });

  it("hard-splits an overlong line, keeping its order", () => {
    const line = "x".repeat(25);
    const chunks = chunkMessage(line, 10);

    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
    expect(chunks.join("")).toBe(line);
  });

  it("does not split a surrogate pair", () => {
    const chunks = chunkMessage(`${"a".repeat(5)}😂😂😂`, 10);

    expect(chunks.join("")).toBe(`${"a".repeat(5)}😂😂😂`);
    expect(chunks.every((chunk) => !chunk.includes("�") && chunk.isWellFormed())).toBe(true);
  });

  it("closes a code fence at a cut and reopens it with its language", () => {
    const code = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`);
    const text = `Intro paragraph.\n\n\`\`\`ts\n${code.join("\n")}\n\`\`\`\n\nOutro.`;
    const chunks = chunkMessage(text, 200);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(chunks.every((chunk) => fenceLines(chunk) % 2 === 0)).toBe(true);
    expect(
      chunks
        .filter((chunk) => chunk.includes("const line"))
        .every((chunk) => chunk.startsWith("```ts\n")),
    ).toBe(true);
    expect(chunks.at(-1)?.endsWith("Outro.")).toBe(true);
  });

  it("keeps every line of the source in order across chunks", () => {
    const code = Array.from({ length: 300 }, (_, index) => `line ${index}`);
    const text = `\`\`\`\n${code.join("\n")}\n\`\`\``;
    const chunks = chunkMessage(text, DISCORD_MESSAGE_LIMIT);

    const contentLines = chunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => !line.startsWith("```"));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
    expect(contentLines).toEqual(code);
  });
});
