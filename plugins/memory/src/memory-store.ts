import { and, asc, count, eq, isNotNull, isNull, or } from "drizzle-orm";
import * as SqliteDrizzle from "drizzle-orm/effect-sqlite-bun";
import { Array, Context, DateTime, Effect, Layer, Option } from "effect";
import { ConversationId } from "@gloaming/caw-plugin-sdk/ids";
import { memoriesTable } from "./memories-table.ts";
import type { MemoryId } from "./memory.ts";
import {
  maxBodyLength,
  maxTitleLength,
  Memory,
  MemoryId as MemoryIdSchema,
  MemoryNotFound,
  MemoryScope,
  MemoryScopeFull,
  memoriesPerScope,
  MemoryTooLong,
} from "./memory.ts";

type MemoryRow = typeof memoriesTable.$inferSelect;

const decodeRow = (row: MemoryRow): Memory =>
  new Memory({
    id: MemoryIdSchema.make(row.id),
    scope: Option.match(Option.fromNullishOr(row.conversationId), {
      onNone: () => MemoryScope.cases.Global.make({}),
      onSome: (conversationId) =>
        MemoryScope.cases.Conversation.make({
          conversationId: ConversationId.make(conversationId),
        }),
    }),
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    createdAt: DateTime.makeUnsafe(row.createdAt),
    lastUsedAt: DateTime.makeUnsafe(row.lastUsedAt),
  });

const scopeColumns = (scope: MemoryScope) =>
  MemoryScope.match(scope, {
    Global: () => ({ scope: "global" as const, conversationId: null }),
    Conversation: ({ conversationId }) => ({ scope: "conversation" as const, conversationId }),
  });

const inScope = (scope: MemoryScope) =>
  MemoryScope.match(scope, {
    Global: () => isNull(memoriesTable.conversationId),
    Conversation: ({ conversationId }) => eq(memoriesTable.conversationId, conversationId),
  });

/** What a top-level Conversation can see: global Memories and its own. */
const visibleTo = (root: ConversationId) =>
  or(isNull(memoriesTable.conversationId), eq(memoriesTable.conversationId, root));

/** Global first, then by Conversation, oldest first: a stable order for prompts and listings. */
const memoryOrder = [
  isNotNull(memoriesTable.conversationId),
  asc(memoriesTable.conversationId),
  asc(memoriesTable.createdAt),
  asc(memoriesTable.id),
];

const checkLength = (field: "title" | "body", text: string, max: number) =>
  text.length > max ? Effect.fail(new MemoryTooLong({ field, length: text.length })) : Effect.void;

export interface MemoryDraft {
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
}

/** Fields left `None` keep their value. */
export interface MemoryChanges {
  readonly title: Option.Option<string>;
  readonly body: Option.Option<string>;
}

/** Memories in the core database. `root` is always a top-level Conversation. */
export class MemoryStore extends Context.Service<
  MemoryStore,
  {
    readonly save: (
      scope: MemoryScope,
      draft: MemoryDraft,
    ) => Effect.Effect<Memory, MemoryScopeFull | MemoryTooLong>;
    readonly update: (
      root: ConversationId,
      id: MemoryId,
      changes: MemoryChanges,
    ) => Effect.Effect<Memory, MemoryNotFound | MemoryTooLong>;
    readonly forget: (root: ConversationId, id: MemoryId) => Effect.Effect<void, MemoryNotFound>;
    /** Marks the Memory used, so `lastUsedAt` shows what the agent still relies on. */
    readonly read: (root: ConversationId, id: MemoryId) => Effect.Effect<Memory, MemoryNotFound>;
    readonly pin: (
      root: ConversationId,
      id: MemoryId,
      pinned: boolean,
    ) => Effect.Effect<Memory, MemoryNotFound>;
    readonly visible: (root: ConversationId) => Effect.Effect<ReadonlyArray<Memory>>;
    readonly pinned: (root: ConversationId) => Effect.Effect<ReadonlyArray<Memory>>;
    readonly all: Effect.Effect<ReadonlyArray<Memory>>;
  }
>()("@caw/plugin-memory/MemoryStore") {
  static readonly layer = Layer.effect(
    MemoryStore,
    Effect.gen(function* () {
      const db = yield* SqliteDrizzle.makeWithDefaults();
      const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

      const updateVisible = (
        root: ConversationId,
        id: MemoryId,
        set: Partial<Omit<MemoryRow, "id">>,
      ) =>
        db
          .update(memoriesTable)
          .set(set)
          .where(and(eq(memoriesTable.id, id), visibleTo(root)))
          .returning()
          .pipe(
            Effect.orDie,
            Effect.flatMap((rows) =>
              Option.match(Array.head(rows), {
                onNone: () => Effect.fail(new MemoryNotFound({ id })),
                onSome: (row) => Effect.succeed(decodeRow(row)),
              }),
            ),
          );

      const save = Effect.fn("MemoryStore.save")(function* (
        scope: MemoryScope,
        draft: MemoryDraft,
      ) {
        yield* checkLength("title", draft.title, maxTitleLength);
        yield* checkLength("body", draft.body, maxBodyLength);

        const [counted] = yield* db
          .select({ total: count() })
          .from(memoriesTable)
          .where(inScope(scope))
          .pipe(Effect.orDie);

        if ((counted?.total ?? 0) >= memoriesPerScope) {
          return yield* new MemoryScopeFull({ scope });
        }

        const now = yield* nowMillis;

        const rows = yield* db
          .insert(memoriesTable)
          .values({ ...scopeColumns(scope), ...draft, createdAt: now, lastUsedAt: now })
          .returning()
          .pipe(Effect.orDie);

        return yield* Effect.fromOption(Array.head(rows)).pipe(Effect.orDie, Effect.map(decodeRow));
      });

      const update = Effect.fn("MemoryStore.update")(function* (
        root: ConversationId,
        id: MemoryId,
        changes: MemoryChanges,
      ) {
        yield* Effect.forEach(Option.toArray(changes.title), (title) =>
          checkLength("title", title, maxTitleLength),
        );
        yield* Effect.forEach(Option.toArray(changes.body), (body) =>
          checkLength("body", body, maxBodyLength),
        );

        const now = yield* nowMillis;

        return yield* updateVisible(root, id, {
          ...Option.match(changes.title, { onNone: () => ({}), onSome: (title) => ({ title }) }),
          ...Option.match(changes.body, { onNone: () => ({}), onSome: (body) => ({ body }) }),
          lastUsedAt: now,
        });
      });

      const forget = Effect.fn("MemoryStore.forget")(function* (
        root: ConversationId,
        id: MemoryId,
      ) {
        const removed = yield* db
          .delete(memoriesTable)
          .where(and(eq(memoriesTable.id, id), visibleTo(root)))
          .returning({ id: memoriesTable.id })
          .pipe(Effect.orDie);

        yield* removed.length === 0 ? Effect.fail(new MemoryNotFound({ id })) : Effect.void;
      });

      const read = Effect.fn("MemoryStore.read")(function* (root: ConversationId, id: MemoryId) {
        const now = yield* nowMillis;

        return yield* updateVisible(root, id, { lastUsedAt: now });
      });

      const pin = Effect.fn("MemoryStore.pin")(
        (root: ConversationId, id: MemoryId, pinned: boolean) =>
          updateVisible(root, id, { pinned }),
      );

      const select = (where: ReturnType<typeof visibleTo>) =>
        db
          .select()
          .from(memoriesTable)
          .where(where)
          .orderBy(...memoryOrder)
          .pipe(Effect.orDie, Effect.map(Array.map(decodeRow)));

      const visible = Effect.fn("MemoryStore.visible")((root: ConversationId) =>
        select(visibleTo(root)),
      );

      const pinned = Effect.fn("MemoryStore.pinned")((root: ConversationId) =>
        select(and(visibleTo(root), eq(memoriesTable.pinned, true))),
      );

      const all = select(undefined);

      return { save, update, forget, read, pin, visible, pinned, all };
    }),
  );
}
