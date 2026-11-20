import type { ChannelMessage } from "@omen/sdk/channel";
import { DateTime, Option } from "effect";

/** An attachment as the agent sees it: saved into the Workspace inbox when the download worked. */
export interface AttachmentRef {
  readonly name: string;
  readonly kind: "image" | "file";
  readonly savedTo: Option.Option<string>;
}

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', "&quot;");

const attribute = (name: string, value: string) => `${name}="${escapeAttribute(value)}"`;

/** `Nov 20, 2026, 9:12 AM` in the given zone. */
const formatTime = (time: DateTime.DateTime, timezone: string) => {
  const date = DateTime.format(time, {
    locale: "en-US",
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const clock = DateTime.format(time, {
    locale: "en-US",
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });

  // Newer ICU data puts a narrow no-break space before AM/PM.
  return `${date}, ${clock.replaceAll("\u202F", " ")}`;
};

const attachmentLine = (attachment: AttachmentRef) =>
  Option.match(attachment.savedTo, {
    onNone: () => `[${attachment.kind}: ${escapeText(attachment.name)}]`,
    onSome: (path) =>
      `[${attachment.kind}: ${escapeText(attachment.name)} — saved to ${escapeText(path)}]`,
  });

/** One `<message>` block. */
export const formatMessage = (
  message: ChannelMessage,
  attachments: ReadonlyArray<AttachmentRef>,
  timezone: string,
) => {
  const attributes = [
    attribute("id", message.messageId),
    attribute("sender", message.author.name),
    attribute("time", formatTime(message.sentAt, timezone)),
    ...Option.match(message.replyTo, {
      onNone: () => [],
      onSome: (quoted) => [attribute("reply_to", quoted.messageId)],
    }),
  ];

  const quote = Option.match(message.replyTo, {
    onNone: () => [],
    onSome: (quoted) => [
      `  <quoted_message ${attribute("from", quoted.author.name)}>${escapeText(quoted.text)}</quoted_message>`,
    ],
  });

  const text = message.text.length === 0 ? [] : [escapeText(message.text)];

  return [
    `<message ${attributes.join(" ")}>`,
    ...quote,
    ...text,
    ...attachments.map(attachmentLine),
    "</message>",
  ].join("\n");
};

/** A Turn input: the time zone context, then each block newline-joined with no wrapper. */
export const formatInput = (timezone: string, blocks: ReadonlyArray<string>) =>
  [`<context ${attribute("timezone", timezone)}/>`, ...blocks].join("\n");

/** A scheduled prompt. */
export const formatTask = (prompt: string, now: DateTime.DateTime, timezone: string) =>
  `<task ${attribute("current_time", formatTime(now, timezone))}>${escapeText(prompt)}</task>`;

/** Recent Channel messages handed to a lost Session's replacement. */
export const formatHistory = (messages: ReadonlyArray<ChannelMessage>, timezone: string) =>
  [
    "<channel-history>",
    ...messages.map((message) => formatMessage(message, referencesOf(message), timezone)),
    "</channel-history>",
  ].join("\n");

/** Attachments referenced by name only, for messages Omen did not download. */
export const referencesOf = (message: ChannelMessage): ReadonlyArray<AttachmentRef> =>
  message.attachments.map((attachment) => ({
    name: attachment.name,
    kind: Option.exists(attachment.contentType, (type) => type.startsWith("image/"))
      ? "image"
      : "file",
    savedTo: Option.none(),
  }));
