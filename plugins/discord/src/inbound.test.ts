import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { ChannelInput, ConversationPlace } from "@gloaming/caw-plugin-sdk/channel";
import { ExternalConversationId } from "@gloaming/caw-plugin-sdk/ids";
import type { DiscordMessage } from "./inbound.ts";
import { isFromPerson, parseCommand, parseMessage } from "./inbound.ts";

const person = { id: "u1", name: "Ada", bot: false };

const message: DiscordMessage = {
  id: "m1",
  channelId: "c1",
  place: { kind: "guild" },
  author: person,
  system: false,
  content: "hello",
  createdTimestamp: 1_790_000_000_000,
  referenced: null,
  attachments: [],
};

const respond = () => Effect.void;

describe("parseMessage", () => {
  it("parses a guild message as a Room", () => {
    const parsed = Option.getOrThrow(parseMessage(message));

    expect(parsed.conversation).toBe("c1");
    expect(parsed.messageId).toBe("m1");
    expect(parsed.place).toEqual(ConversationPlace.Room());
    expect(parsed.author).toEqual({ id: "u1", name: "Ada" });
    expect(parsed.text).toBe("hello");
    expect(DateTime.toEpochMillis(parsed.sentAt)).toBe(1_790_000_000_000);
    expect(parsed.replyTo).toEqual(Option.none());
  });

  it("places a thread message under its parent and a DM as Direct", () => {
    const thread = parseMessage({ ...message, place: { kind: "thread", parentId: "p1" } });
    const direct = parseMessage({ ...message, place: { kind: "direct" } });

    expect(Option.map(thread, (parsed) => parsed.place)).toEqual(
      Option.some(ConversationPlace.Thread({ parent: ExternalConversationId.make("p1") })),
    );
    expect(Option.map(direct, (parsed) => parsed.place)).toEqual(
      Option.some(ConversationPlace.Direct()),
    );
  });

  it("drops a thread message without a parent", () => {
    expect(parseMessage({ ...message, place: { kind: "thread", parentId: null } })).toEqual(
      Option.none(),
    );
  });

  it("keeps the quoted message and attachments", () => {
    const parsed = Option.getOrThrow(
      parseMessage({
        ...message,
        referenced: { id: "m0", author: { id: "u2", name: "Caw", bot: true }, content: "earlier" },
        attachments: [
          { name: "a.png", url: "https://cdn/a.png", contentType: "image/png" },
          { name: "b.bin", url: "https://cdn/b.bin", contentType: null },
        ],
      }),
    );

    expect(parsed.replyTo).toEqual(
      Option.some({ messageId: "m0", author: { id: "u2", name: "Caw" }, text: "earlier" }),
    );
    expect(parsed.attachments).toEqual([
      { name: "a.png", url: "https://cdn/a.png", contentType: Option.some("image/png") },
      { name: "b.bin", url: "https://cdn/b.bin", contentType: Option.none() },
    ]);
  });
});

describe("isFromPerson", () => {
  it("accepts people and ignores bots and system notices", () => {
    expect(isFromPerson(message)).toBe(true);
    expect(isFromPerson({ ...message, author: { ...person, bot: true } })).toBe(false);
    expect(isFromPerson({ ...message, system: true })).toBe(false);
  });
});

describe("parseCommand", () => {
  it("maps /new and /stop to commands", () => {
    const parsed = parseCommand(
      { commandName: "stop", channelId: "c1", place: { kind: "direct" } },
      respond,
    );

    expect(
      parsed.pipe(
        Option.filter(ChannelInput.$is("Command")),
        Option.map((input) => input.command),
      ),
    ).toEqual(Option.some("stop"));
  });

  it("ignores commands Caw does not define", () => {
    expect(
      parseCommand({ commandName: "ban", channelId: "c1", place: { kind: "guild" } }, respond),
    ).toEqual(Option.none());
  });
});
