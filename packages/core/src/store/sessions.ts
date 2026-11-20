import { Session, SessionStatus } from "@gloaming/caw-plugin-sdk/conversation";
import { ResumeCursor } from "@gloaming/caw-plugin-sdk/harness";
import { ConversationId, HarnessName, ProfileName, SessionId } from "@gloaming/caw-plugin-sdk/ids";
import { and, desc, eq, inArray } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Clock, Context, Effect, Layer, Option, Schema } from "effect";
import { Database } from "./database.ts";

const sessionsTable = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  harness: text("harness").notNull(),
  profile: text("profile").notNull(),
  status: text("status").notNull(),
  resumeCursorJson: text("resume_cursor_json"),
  runtimePayloadJson: text("runtime_payload_json"),
  forkedFromSessionId: text("forked_from_session_id"),
  lastSeenAt: integer("last_seen_at").notNull(),
});

const CursorJson = Schema.fromJsonString(ResumeCursor);

const SessionRow = Schema.Struct({
  id: SessionId,
  conversationId: ConversationId,
  harness: HarnessName,
  profile: ProfileName,
  status: SessionStatus,
  forkedFromSessionId: Schema.OptionFromNullOr(SessionId),
  resumeCursorJson: Schema.OptionFromNullOr(CursorJson),
});

const decodeRow = Schema.decodeUnknownEffect(SessionRow);
const encodeCursor = Schema.encodeEffect(CursorJson);

/** A Session row with the Harness cursor it resumes from, once the Harness reported one. */
export interface StoredSession {
  readonly session: Session;
  readonly cursor: Option.Option<ResumeCursor>;
}

const toStored = (row: typeof sessionsTable.$inferSelect) =>
  decodeRow(row).pipe(
    Effect.map((fields): StoredSession => ({
      session: new Session({ ...fields, forkedFrom: fields.forkedFromSessionId }),
      cursor: fields.resumeCursorJson,
    })),
    Effect.orDie,
  );

const firstStored = (rows: ReadonlyArray<typeof sessionsTable.$inferSelect>) =>
  Option.match(Option.fromNullishOr(rows[0]), {
    onNone: () => Effect.succeedNone,
    onSome: (row) => Effect.asSome(toStored(row)),
  });

/** The `sessions` table. A Conversation's current Session is its latest `live` or `idle` row. */
export class Sessions extends Context.Service<
  Sessions,
  {
    readonly insert: (session: Session) => Effect.Effect<void>;
    readonly get: (id: SessionId) => Effect.Effect<Option.Option<StoredSession>>;
    readonly current: (conversation: ConversationId) => Effect.Effect<Option.Option<StoredSession>>;
    readonly setStatus: (id: SessionId, status: SessionStatus) => Effect.Effect<void>;
    readonly saveCursor: (id: SessionId, cursor: ResumeCursor) => Effect.Effect<void>;
    /** Marks the Session as just used. */
    readonly touch: (id: SessionId) => Effect.Effect<void>;
    /** After a crash no Session is live; each resumes on its next message. */
    readonly idleAllLive: Effect.Effect<void>;
  }
>()("@caw/core/Sessions") {
  static readonly layer = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const db = yield* Database;

      const update = (id: SessionId, values: Partial<typeof sessionsTable.$inferInsert>) =>
        db.update(sessionsTable).set(values).where(eq(sessionsTable.id, id)).pipe(Effect.orDie);

      return {
        insert: Effect.fn("Sessions.insert")(function* (session: Session) {
          const now = yield* Clock.currentTimeMillis;

          yield* db
            .insert(sessionsTable)
            .values({
              id: session.id,
              conversationId: session.conversationId,
              harness: session.harness,
              profile: session.profile,
              status: session.status,
              forkedFromSessionId: Option.getOrNull(session.forkedFrom),
              lastSeenAt: now,
            })
            .pipe(Effect.orDie);
        }),
        get: Effect.fn("Sessions.get")(function* (id: SessionId) {
          const rows = yield* db
            .select()
            .from(sessionsTable)
            .where(eq(sessionsTable.id, id))
            .pipe(Effect.orDie);

          return yield* firstStored(rows);
        }),
        current: Effect.fn("Sessions.current")(function* (conversation: ConversationId) {
          const rows = yield* db
            .select()
            .from(sessionsTable)
            .where(
              and(
                eq(sessionsTable.conversationId, conversation),
                inArray(sessionsTable.status, ["live", "idle"]),
              ),
            )
            .orderBy(desc(sessionsTable.lastSeenAt))
            .limit(1)
            .pipe(Effect.orDie);

          return yield* firstStored(rows);
        }),
        setStatus: Effect.fn("Sessions.setStatus")(function* (
          id: SessionId,
          status: SessionStatus,
        ) {
          yield* update(id, { status });
        }),
        saveCursor: Effect.fn("Sessions.saveCursor")(function* (
          id: SessionId,
          cursor: ResumeCursor,
        ) {
          const resumeCursorJson = yield* encodeCursor(cursor).pipe(Effect.orDie);

          yield* update(id, { resumeCursorJson });
        }),
        touch: Effect.fn("Sessions.touch")(function* (id: SessionId) {
          const lastSeenAt = yield* Clock.currentTimeMillis;

          yield* update(id, { lastSeenAt });
        }),
        idleAllLive: db
          .update(sessionsTable)
          .set({ status: "idle" })
          .where(eq(sessionsTable.status, "live"))
          .pipe(Effect.orDie),
      };
    }),
  );
}
