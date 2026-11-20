import { SqliteClient } from "@effect/sql-sqlite-bun";
import type { Channel } from "@caw/sdk/channel";
import type { ConversationId, PluginName } from "@caw/sdk/ids";
import type { PluginServices } from "@caw/sdk/plugin";
import { ConversationNotFound, Caw, PluginContext } from "@caw/sdk/plugin";
import type { Scope } from "effect";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { EventBus } from "../events/event-bus.ts";
import { Router } from "../routing/router.ts";
import { Conversations } from "../store/conversations.ts";
import { PluginKv } from "../store/plugin-kv.ts";
import { runPluginMigrations } from "../store/migrations.ts";
import type { LoadedPlugin } from "./loaded-plugin.ts";
import { Registration, Registry } from "./registry.ts";

/** The services one Plugin's layer runs with: `Caw` bound to that Plugin, its key-value store, SQL. */
export class PluginScopes extends Context.Service<
  PluginScopes,
  {
    readonly servicesFor: (plugin: PluginName) => Context.Context<PluginServices>;
    /** Runs the Plugin's migrations, then builds its layer in `scope`, which then holds its registrations. */
    readonly launch: (
      plugin: LoadedPlugin,
      layer: Layer.Layer<never, never, PluginServices>,
      scope: Scope.Scope,
    ) => Effect.Effect<void>;
  }
>()("@caw/core/PluginScopes") {
  static readonly layer = Layer.effect(
    PluginScopes,
    Effect.gen(function* () {
      const registry = yield* Registry;
      const router = yield* Router;
      const bus = yield* EventBus;
      const conversations = yield* Conversations;
      const kv = yield* PluginKv;
      const sql = yield* SqlClient.SqlClient;
      const sqlite = yield* SqliteClient.SqliteClient;

      const conversation = (conversationId: ConversationId) =>
        conversations.get(conversationId).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() => new ConversationNotFound({ conversationId })),
        );

      const servicesFor = (plugin: PluginName) => {
        const caw = Caw.of({
          registerChannel: (channel: Channel) =>
            Effect.gen(function* () {
              yield* registry.add(Registration.Channel({ plugin, channel }));
              yield* Effect.forkScoped(router.consume(channel));
            }),
          registerHarness: (harness) => registry.add(Registration.Harness({ plugin, harness })),
          registerTool: (tool) => registry.add(Registration.Tool({ plugin, tool })),
          registerInterceptor: (interceptor) =>
            registry.add(Registration.Interceptor({ plugin, interceptor })),
          registerCliCommand: (command) =>
            registry.add(Registration.CliCommand({ plugin, command })),
          registerProfiles: (lookup) => registry.add(Registration.Profiles({ plugin, lookup })),
          events: bus.events,
          bus: bus.pluginMessages,
          conversation,
          send: router.send,
          deliverTask: router.deliverTask,
        });

        const context = PluginContext.of({
          name: plugin,
          get: (key, schema) =>
            Effect.flatMap(kv.get(plugin, key), (stored) =>
              Option.match(stored, {
                onNone: () => Effect.succeedNone,
                onSome: (json) =>
                  Effect.asSome(
                    Effect.orDie(Schema.decodeEffect(Schema.fromJsonString(schema))(json)),
                  ),
              }),
            ),
          set: (key, schema, value) =>
            Effect.flatMap(
              Effect.orDie(Schema.encodeEffect(Schema.fromJsonString(schema))(value)),
              (json) => kv.set(plugin, key, json),
            ),
        });

        return Context.make(Caw, caw).pipe(
          Context.add(PluginContext, context),
          Context.add(SqlClient.SqlClient, sql),
          Context.add(SqliteClient.SqliteClient, sqlite),
        );
      };

      const launch = Effect.fn("PluginScopes.launch")(function* (
        plugin: LoadedPlugin,
        layer: Layer.Layer<never, never, PluginServices>,
        scope: Scope.Scope,
      ) {
        yield* runPluginMigrations(plugin.name, plugin.migrations).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.orDie,
        );
        yield* Layer.buildWithScope(
          Layer.provide(layer, Layer.succeedContext(servicesFor(plugin.name))),
          scope,
        );
      });

      return { servicesFor, launch };
    }),
  );
}
