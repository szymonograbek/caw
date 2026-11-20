import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Conversation } from "@gloaming/caw-plugin-sdk/conversation";
import { ChannelName, ConversationId, ExternalConversationId } from "@gloaming/caw-plugin-sdk/ids";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { temporaryHome } from "../testing/test-daemon.ts";
import { Conversations } from "./conversations.ts";
import { storeLayer } from "./database.ts";

const store = (filename: string) =>
  Conversations.layer.pipe(Layer.provideMerge(storeLayer(filename)));

const conversation = new Conversation({
  id: ConversationId.make("c1"),
  channel: ChannelName.make("fake"),
  externalId: ExternalConversationId.make("room"),
  parentId: Option.none(),
  replyMode: "threaded",
  profile: Option.none(),
});

describe("core migrations", () => {
  it.effect("run once and keep the data when the database is reused", () =>
    Effect.gen(function* () {
      const home = yield* temporaryHome;
      const filename = NodePath.join(home, "caw.db");

      yield* Conversations.use((conversations) => conversations.insert(conversation)).pipe(
        Effect.provide(store(filename)),
      );

      const [found, applied, pragmas] = yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const sql = yield* SqlClient.SqlClient;

        return [
          yield* conversations.get(conversation.id),
          yield* sql<{
            readonly migration_id: number;
          }>`SELECT migration_id FROM effect_sql_migrations`,
          yield* sql<{ readonly foreign_keys: number }>`PRAGMA foreign_keys`,
        ] as const;
      }).pipe(Effect.provide(store(filename)));

      expect(found).toEqual(Option.some(conversation));
      expect(applied).toEqual([{ migration_id: 1 }]);
      expect(pragmas).toEqual([{ foreign_keys: 1 }]);
    }).pipe(Effect.scoped),
  );
});
