import type { Channel, ChannelInput, ChannelMessage } from "@gloaming/caw-plugin-sdk/channel";
import { ConversationPlace } from "@gloaming/caw-plugin-sdk/channel";
import type { Conversation } from "@gloaming/caw-plugin-sdk/conversation";
import { CawEvent } from "@gloaming/caw-plugin-sdk/events";
import type { ConversationId } from "@gloaming/caw-plugin-sdk/ids";
import { ConversationNotFound } from "@gloaming/caw-plugin-sdk/plugin";
import { Cause, Context, DateTime, Effect, Layer, Match, Option, Stream } from "effect";
import { DaemonConfig } from "../home/daemon-config.ts";
import { CawHome } from "../home/caw-home.ts";
import { EventBus } from "../events/event-bus.ts";
import { InterceptorChains } from "../plugins/interceptor-chains.ts";
import { Registry } from "../plugins/registry.ts";
import { MessageRef, SessionInput } from "../sessions/session-link.ts";
import { SessionPool } from "../sessions/session-pool.ts";
import { Conversations } from "../store/conversations.ts";
import { MessageMap } from "../store/message-map.ts";
import { Sessions } from "../store/sessions.ts";
import { Attachments } from "./attachments.ts";
import { ConversationPlaces } from "./conversation-places.ts";
import { formatInput, formatMessage, formatTask } from "./inbound-format.ts";
import { SessionRouting } from "./session-routing.ts";

/** The first 80 characters of the text, or "Caw" when there are none. */
const threadName = (text: string) => {
  const name = text.replaceAll(/\s+/g, " ").trim().slice(0, 80);

  return name.length === 0 ? "Caw" : name;
};

/** Logs a failed handling step without stopping the Channel's input stream. */
const logFailure = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  Effect.catchCause(effect, (cause) =>
    Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logError(what, cause),
  );

/** A top-level threaded Room answers each message in a new thread opened from it. */
const opensThread = (conversation: Conversation) =>
  Option.isNone(conversation.parentId) && conversation.replyMode === "threaded";

/** Turns Channel inputs and scheduled tasks into Session inputs. */
export class Router extends Context.Service<
  Router,
  {
    /** Handles the Channel's inputs, in order, until its stream ends. */
    readonly consume: (channel: Channel) => Effect.Effect<void>;
    readonly send: (
      conversationId: ConversationId,
      text: string,
    ) => Effect.Effect<void, ConversationNotFound>;
    readonly deliverTask: (
      conversationId: ConversationId,
      prompt: string,
    ) => Effect.Effect<void, ConversationNotFound>;
  }
>()("@caw/core/Router") {
  static readonly layer = Layer.effect(
    Router,
    Effect.gen(function* () {
      const config = yield* DaemonConfig;
      const home = yield* CawHome;
      const bus = yield* EventBus;
      const chains = yield* InterceptorChains;
      const registry = yield* Registry;
      const conversations = yield* Conversations;
      const sessions = yield* Sessions;
      const messageMap = yield* MessageMap;
      const attachments = yield* Attachments;
      const places = yield* ConversationPlaces;
      const routing = yield* SessionRouting;
      const pool = yield* SessionPool;

      const openThread = Effect.fn("Router.openThread")(function* (
        channel: Channel,
        room: Conversation,
        from: MessageRef,
        name: string,
      ) {
        const thread = yield* channel.openThread(room.externalId, from.id, name);

        return yield* places.resolve(
          channel.name,
          thread,
          ConversationPlace.Thread({ parent: room.externalId }),
        );
      });

      const handleMessage = Effect.fn("Router.handleMessage")(function* (
        channel: Channel,
        received: ChannelMessage,
      ) {
        const arrived = yield* places.resolve(channel.name, received.conversation, received.place);

        yield* bus.publish(CawEvent.MessageReceived({ conversation: arrived, message: received }));

        const accepted = yield* chains.inbound(received, arrived);

        if (Option.isNone(accepted)) {
          return;
        }

        const message = accepted.value;
        const ref = new MessageRef({ conversation: message.conversation, id: message.messageId });
        const root = yield* places.root(arrived);

        const conversation = opensThread(arrived)
          ? yield* openThread(channel, arrived, ref, threadName(message.text))
          : arrived;

        // A thread a person opens off an inline Conversation Forks its Session.
        const forkFrom =
          Option.isSome(arrived.parentId) && root.replyMode === "inline"
            ? Option.some(root)
            : Option.none();

        const target = yield* routing.target(channel, conversation, root, forkFrom);
        const saved = yield* attachments.save(home.workspace(root.id), message);

        yield* messageMap.record(arrived.id, [message.messageId], Option.some(target.session.id));
        yield* pool.submit(
          target,
          new SessionInput({
            text: formatInput(config.timezone, [formatMessage(message, saved, config.timezone)]),
            messages: [ref],
          }),
        );
      });

      const handleInput = (channel: Channel, input: ChannelInput) =>
        Match.valueTags(input, {
          Message: ({ message }) =>
            logFailure(
              "Handling a message failed",
              handleMessage(channel, message).pipe(
                Effect.annotateLogs({ channel: channel.name, messageId: message.messageId }),
              ),
            ),
          Command: (command) =>
            logFailure(
              "Handling a command failed",
              Effect.gen(function* () {
                const conversation = yield* places.resolve(
                  channel.name,
                  command.conversation,
                  command.place,
                );

                const current = yield* sessions.current(conversation.id);

                if (command.command === "new") {
                  yield* Option.match(current, {
                    onNone: () => Effect.void,
                    onSome: (stored) => pool.close(stored.session.id, "reset"),
                  });

                  return yield* command.respond("Started a new session.");
                }

                yield* Option.match(current, {
                  onNone: () => Effect.void,
                  onSome: (stored) => pool.interrupt(stored.session.id),
                });

                return yield* command.respond("Stopped.");
              }),
            ),
        });

      const conversationById = (conversationId: ConversationId) =>
        Effect.flatMap(conversations.get(conversationId), (found) =>
          Option.match(found, {
            onNone: () => Effect.fail(new ConversationNotFound({ conversationId })),
            onSome: (conversation) =>
              Effect.map(registry.channel(conversation.channel), (channel) => ({
                conversation,
                channel,
              })),
          }),
        );

      const deliverTask = Effect.fn("Router.deliverTask")(function* (
        conversationId: ConversationId,
        prompt: string,
      ) {
        const { conversation: scheduled, channel: found } = yield* conversationById(conversationId);

        if (Option.isNone(found)) {
          yield* Effect.logWarning("No Channel for the scheduled task's Conversation");

          return;
        }

        const channel = found.value;
        const now = yield* DateTime.now;
        const root = yield* places.root(scheduled);
        const text = formatInput(config.timezone, [formatTask(prompt, now, config.timezone)]);

        const posted = opensThread(scheduled)
          ? yield* channel.send(scheduled.externalId, "⏰ Scheduled task")
          : [];

        const announcement = Option.map(
          Option.fromNullishOr(posted[0]),
          (id) => new MessageRef({ conversation: scheduled.externalId, id }),
        );

        const conversation = Option.isSome(announcement)
          ? yield* openThread(channel, scheduled, announcement.value, threadName(prompt))
          : scheduled;

        const target = yield* routing.target(channel, conversation, root, Option.none());

        yield* pool.submit(
          target,
          new SessionInput({ text, messages: Option.toArray(announcement) }),
        );
      });

      return {
        consume: (channel) =>
          channel.inputs.pipe(
            Stream.runForEach((input) => handleInput(channel, input)),
            (consumed) => logFailure("A Channel's input stream failed", consumed),
          ),
        send: Effect.fn("Router.send")(function* (conversationId: ConversationId, text: string) {
          const { conversation, channel } = yield* conversationById(conversationId);

          if (Option.isNone(channel)) {
            yield* Effect.logWarning("No Channel for the Conversation");

            return;
          }

          yield* logFailure("Sending failed", channel.value.send(conversation.externalId, text));
        }),
        deliverTask: (conversationId, prompt) =>
          deliverTask(conversationId, prompt).pipe(
            Effect.catchTags({
              ChannelError: (error) => Effect.logError("Delivering a scheduled task failed", error),
              NoHarnessRegistered: (error) =>
                Effect.logError("Delivering a scheduled task failed", error),
            }),
          ),
      };
    }),
  );
}
