import { describe, expect, it } from "@effect/vitest";
import { ChannelMessageId } from "@gloaming/caw-plugin-sdk/ids";
import { DateTime, Option } from "effect";
import { message } from "../testing/test-daemon.ts";
import { formatHistory, formatInput, formatMessage, formatTask } from "./inbound-format.ts";

const zone = "Europe/Warsaw";

describe("inbound format", () => {
  it("formats a message with its quote, text and saved attachment", () => {
    const received = {
      ...message("room", "m2", "look at <this> & that"),
      replyTo: Option.some({
        messageId: ChannelMessageId.make("m1"),
        author: { id: "u2", name: 'Bo "B"' },
        text: "earlier",
      }),
    };

    expect(
      formatInput(zone, [
        formatMessage(
          received,
          [
            { name: "foo.png", kind: "image", savedTo: Option.some("/ws/inbox/m2/foo.png") },
            { name: "notes.txt", kind: "file", savedTo: Option.none() },
          ],
          zone,
        ),
      ]),
    ).toBe(
      [
        '<context timezone="Europe/Warsaw"/>',
        '<message id="m2" sender="Ada" time="Nov 20, 2026, 9:12 AM" reply_to="m1">',
        '  <quoted_message from="Bo &quot;B&quot;">earlier</quoted_message>',
        "look at &lt;this&gt; &amp; that",
        "[image: foo.png — saved to /ws/inbox/m2/foo.png]",
        "[file: notes.txt]",
        "</message>",
      ].join("\n"),
    );
  });

  it("joins several messages without a wrapper", () => {
    const blocks = [
      formatMessage(message("dm", "a", "one"), [], zone),
      formatMessage(message("dm", "b", "two"), [], zone),
    ];

    expect(formatInput(zone, blocks)).toBe(
      [
        '<context timezone="Europe/Warsaw"/>',
        '<message id="a" sender="Ada" time="Nov 20, 2026, 9:12 AM">',
        "one",
        "</message>",
        '<message id="b" sender="Ada" time="Nov 20, 2026, 9:12 AM">',
        "two",
        "</message>",
      ].join("\n"),
    );
  });

  it("formats a scheduled task and Channel history", () => {
    const now = DateTime.makeUnsafe("2026-11-20T23:30:00Z");

    const withAttachment = {
      ...message("dm", "h1", "see file"),
      attachments: [
        { name: "a.pdf", url: "https://x/a.pdf", contentType: Option.some("application/pdf") },
      ],
    };

    expect(formatTask("Water the plants", now, zone)).toBe(
      '<task current_time="Nov 21, 2026, 12:30 AM">Water the plants</task>',
    );
    expect(formatHistory([withAttachment], zone)).toBe(
      [
        "<channel-history>",
        '<message id="h1" sender="Ada" time="Nov 20, 2026, 9:12 AM">',
        "see file",
        "[file: a.pdf]",
        "</message>",
        "</channel-history>",
      ].join("\n"),
    );
  });
});
