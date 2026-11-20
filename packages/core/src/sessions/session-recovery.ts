import type { ChannelError } from "@caw/sdk/channel";
import { Session } from "@caw/sdk/conversation";
import { CawEvent } from "@caw/sdk/events";
import { SessionStart } from "@caw/sdk/harness";
import { Context, Effect, Layer, Option } from "effect";
import { EventBus } from "../events/event-bus.ts";
import { DaemonConfig } from "../home/daemon-config.ts";
import { formatHistory } from "../routing/inbound-format.ts";
import { newSessionId } from "../store/new-ids.ts";
import { Sessions } from "../store/sessions.ts";
import { SessionInput } from "./session-link.ts";
import type { SessionTarget } from "./session-target.ts";

const lostNotice = "⚠️ Previous session was lost; started a new one with recent history.";

const logChannelFailure =
  (what: string) =>
  <A, R>(effect: Effect.Effect<A, ChannelError, R>) =>
    Effect.catchTag(effect, "ChannelError", (error) => Effect.logWarning(what, error));

/** What happens to the inputs a Session never answered. */
export class SessionRecovery extends Context.Service<
  SessionRecovery,
  {
    /**
     * Records a replacement for a lost Session and posts the notice. Its first
     * input carries the Channel's recent history, then the unanswered inputs.
     */
    readonly replace: (
      lost: SessionTarget,
      unanswered: ReadonlyArray<SessionInput>,
    ) => Effect.Effect<{ readonly target: SessionTarget; readonly input: SessionInput }>;
    /** Reacts ❌ on the inputs' messages and says why. */
    readonly reportUnanswered: (
      target: SessionTarget,
      unanswered: ReadonlyArray<SessionInput>,
      message: string,
    ) => Effect.Effect<void>;
  }
>()("@caw/core/SessionRecovery") {
  static readonly layer = Layer.effect(
    SessionRecovery,
    Effect.gen(function* () {
      const config = yield* DaemonConfig;
      const sessions = yield* Sessions;
      const bus = yield* EventBus;

      return {
        replace: Effect.fn("SessionRecovery.replace")(function* (
          lost: SessionTarget,
          unanswered: ReadonlyArray<SessionInput>,
        ) {
          const { channel, conversation } = lost;

          const replacement = new Session({
            id: yield* newSessionId,
            conversationId: conversation.id,
            harness: lost.profile.harness,
            profile: lost.profile.name,
            status: "live",
            forkedFrom: Option.none(),
          });

          const history = yield* channel
            .history(conversation.externalId, config.historyLimit)
            .pipe(
              Effect.catchTag("ChannelError", (error) =>
                Effect.as(Effect.logWarning("Reading Channel history failed", error), []),
              ),
            );

          yield* sessions.insert(replacement);
          yield* bus.publish(
            CawEvent.SessionLost({ sessionId: lost.session.id, replacement: replacement.id }),
          );
          yield* channel
            .send(conversation.externalId, lostNotice)
            .pipe(logChannelFailure("Posting the notice failed"));

          return {
            target: { ...lost, session: replacement, start: SessionStart.New() },
            input: new SessionInput({
              text: [
                formatHistory(history, config.timezone),
                ...unanswered.map((input) => input.text),
              ].join("\n"),
              messages: unanswered.flatMap((input) => input.messages),
            }),
          };
        }),
        reportUnanswered: (target, unanswered, message) =>
          Effect.gen(function* () {
            const { channel, conversation } = target;

            yield* Effect.forEach(
              unanswered.flatMap((input) => input.messages),
              (ref) => channel.react(ref.conversation, ref.id, "❌"),
            );
            yield* channel.send(conversation.externalId, `❌ The Session failed: ${message}`);
          }).pipe(logChannelFailure("Reporting the failure failed")),
      };
    }),
  );
}
