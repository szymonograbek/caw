import { Schema } from "effect";
import { ConversationId } from "@caw/sdk/ids";

export const MemoryId = Schema.Int.pipe(Schema.brand("MemoryId"));

export type MemoryId = typeof MemoryId.Type;

/** A Memory belongs to every Conversation, or to one top-level Conversation and its threads. */
export const MemoryScope = Schema.TaggedUnion({
  Global: {},
  Conversation: { conversationId: ConversationId },
});

export type MemoryScope = typeof MemoryScope.Type;

export class Memory extends Schema.Class<Memory, { readonly brand: unique symbol }>("Memory")({
  id: MemoryId,
  scope: MemoryScope,
  title: Schema.String,
  body: Schema.String,
  pinned: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  lastUsedAt: Schema.DateTimeUtc,
}) {}

/** Hard caps (ADR 0003). Saves past them are rejected; nothing is evicted. */
export const memoriesPerScope = 100;

export const maxBodyLength = 1000;

export const maxTitleLength = 100;

export const scopeLabel = (scope: MemoryScope): string =>
  MemoryScope.match(scope, {
    Global: () => "global",
    Conversation: () => "conversation",
  });

export class MemoryNotFound extends Schema.TaggedError<
  MemoryNotFound,
  { readonly brand: unique symbol }
>()("MemoryNotFound", {
  id: MemoryId,
}) {}

export class MemoryScopeFull extends Schema.TaggedError<
  MemoryScopeFull,
  { readonly brand: unique symbol }
>()("MemoryScopeFull", { scope: MemoryScope }) {}

export class MemoryTooLong extends Schema.TaggedError<
  MemoryTooLong,
  { readonly brand: unique symbol }
>()("MemoryTooLong", {
  field: Schema.Literals(["title", "body"]),
  length: Schema.Int,
}) {}
