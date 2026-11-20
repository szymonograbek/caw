import type { Channel } from "@gloaming/sdk/channel";
import type { Conversation } from "@gloaming/sdk/conversation";
import { Session } from "@gloaming/sdk/conversation";
import { SessionStart } from "@gloaming/sdk/harness";
import { defaultProfileName, Profile } from "@gloaming/sdk/profile";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Registration, Registry } from "../plugins/registry.ts";
import { SessionPool } from "../sessions/session-pool.ts";
import type { SessionTarget } from "../sessions/session-target.ts";
import { newSessionId } from "../store/new-ids.ts";
import type { StoredSession } from "../store/sessions.ts";
import { Sessions } from "../store/sessions.ts";

export class NoHarnessRegistered extends Schema.TaggedError<
  NoHarnessRegistered,
  { readonly brand: unique symbol }
>()("NoHarnessRegistered", {}) {}

/** A Session stays bound to the profile it started with. */
const resumable = (stored: StoredSession, profile: Profile) =>
  stored.session.profile === profile.name;

/** Picks the Session that answers in a Conversation, starting one when needed. */
export class SessionRouting extends Context.Service<
  SessionRouting,
  {
    /**
     * The Conversation's current Session when its profile still applies, else a
     * new one: a Fork of `forkFrom`'s Session when given and resumable.
     */
    readonly target: (
      channel: Channel,
      conversation: Conversation,
      root: Conversation,
      forkFrom: Option.Option<Conversation>,
    ) => Effect.Effect<SessionTarget, NoHarnessRegistered>;
  }
>()("@gloaming/core/SessionRouting") {
  static readonly layer = Layer.effect(
    SessionRouting,
    Effect.gen(function* () {
      const registry = yield* Registry;
      const sessions = yield* Sessions;
      const pool = yield* SessionPool;

      const resolveProfile = Effect.fn("SessionRouting.resolveProfile")(function* (
        root: Conversation,
      ) {
        const name = Option.getOrElse(root.profile, () => defaultProfileName);
        const registrations = yield* registry.all;

        for (const entry of registrations) {
          if (Registration.$is("Profiles")(entry)) {
            const found = yield* entry.lookup(name);

            if (Option.isSome(found)) {
              return found.value;
            }
          }
        }

        if (name !== defaultProfileName) {
          yield* Effect.logWarning("Unknown profile; using the default").pipe(
            Effect.annotateLogs({ profile: name, conversationId: root.id }),
          );
        }

        const harness = yield* registry.harness(Option.none());

        if (Option.isNone(harness)) {
          return yield* new NoHarnessRegistered();
        }

        return new Profile({
          name: defaultProfileName,
          harness: harness.value.name,
          env: {},
          model: Option.none(),
          cwd: Option.none(),
          settingSources: Option.none(),
          effort: Option.none(),
        });
      });

      const target = Effect.fn("SessionRouting.target")(function* (
        channel: Channel,
        conversation: Conversation,
        root: Conversation,
        forkFrom: Option.Option<Conversation>,
      ) {
        const profile = yield* resolveProfile(root);
        const current = yield* sessions.current(conversation.id);
        const base = { channel, conversation, root, profile };

        if (Option.isSome(current) && resumable(current.value, profile)) {
          return {
            ...base,
            session: current.value.session,
            start: Option.match(current.value.cursor, {
              onNone: () => SessionStart.New(),
              onSome: (cursor) => SessionStart.Resume({ cursor }),
            }),
          };
        }

        if (Option.isSome(current)) {
          yield* pool.close(current.value.session.id, "profile-changed");
        }

        // Only a Conversation's first Session forks; later ones start fresh.
        const forkSource =
          Option.isNone(current) && Option.isSome(forkFrom)
            ? yield* sessions.current(forkFrom.value.id)
            : Option.none<StoredSession>();

        const fork = Option.flatMap(
          Option.filter(forkSource, (stored) => resumable(stored, profile)),
          (stored) => Option.map(stored.cursor, (cursor) => ({ stored, cursor })),
        );

        const session = new Session({
          id: yield* newSessionId,
          conversationId: conversation.id,
          harness: profile.harness,
          profile: profile.name,
          status: "live",
          forkedFrom: Option.map(fork, ({ stored }) => stored.session.id),
        });

        yield* sessions.insert(session);

        const start = Option.match(fork, {
          onNone: () => SessionStart.New(),
          onSome: ({ cursor }) => SessionStart.Fork({ cursor }),
        });

        return { ...base, session, start };
      });

      return { target };
    }),
  );
}
