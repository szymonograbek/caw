import { Effect, Layer } from "effect";
import { EventBus } from "./events/event-bus.ts";
import { HostFiles } from "./home/host-files.ts";
import { OmenHome } from "./home/omen-home.ts";
import { InterceptorChains } from "./plugins/interceptor-chains.ts";
import { PluginHost } from "./plugins/plugin-host.ts";
import { PluginInstaller } from "./plugins/plugin-installer.ts";
import { PluginScopes } from "./plugins/plugin-scopes.ts";
import { Registry } from "./plugins/registry.ts";
import { Attachments } from "./routing/attachments.ts";
import { ConversationPlaces } from "./routing/conversation-places.ts";
import { Router } from "./routing/router.ts";
import { SessionRouting } from "./routing/session-routing.ts";
import { SessionLinks } from "./sessions/session-link-live.ts";
import { SessionPool } from "./sessions/session-pool.ts";
import { SessionRecovery } from "./sessions/session-recovery.ts";
import { Conversations } from "./store/conversations.ts";
import { storeLayer } from "./store/database.ts";
import { MessageMap } from "./store/message-map.ts";
import { PluginKv } from "./store/plugin-kv.ts";
import { PluginRows } from "./store/plugin-rows.ts";
import { Sessions } from "./store/sessions.ts";

const database = Layer.unwrap(
  Effect.gen(function* () {
    const home = yield* OmenHome;
    const files = yield* HostFiles;

    yield* files.ensureDirectory(home.root).pipe(Effect.orDie);

    return storeLayer(home.database);
  }),
);

const repositories = Layer.mergeAll(
  Conversations.layer,
  Sessions.layer,
  MessageMap.layer,
  PluginRows.layer,
  PluginKv.layer,
);

const registrations = InterceptorChains.layer.pipe(Layer.provideMerge(Registry.layer));

const foundation = Layer.mergeAll(
  repositories.pipe(Layer.provideMerge(database)),
  registrations,
  EventBus.layer,
);

const sessions = SessionPool.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(SessionLinks.layer, SessionRecovery.layer)),
);

const routing = Router.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(ConversationPlaces.layer, Attachments.layer, SessionRouting.layer),
  ),
);

const plugins = PluginHost.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(PluginScopes.layer, PluginInstaller.layer)),
);

/**
 * Every core service over one `OmenHome`: store, Plugin host, routing and the
 * live-Session pool. Logging, RPC and the process environment come from the
 * entry point.
 */
export const coreLayer = plugins.pipe(
  Layer.provideMerge(
    routing.pipe(Layer.provideMerge(sessions.pipe(Layer.provideMerge(foundation)))),
  ),
);
