import { CawEvent } from "@caw/sdk/events";
import type { ChannelError } from "@caw/sdk/channel";
import type { HarnessEvent, LiveSession } from "@caw/sdk/harness";
import { HarnessError } from "@caw/sdk/harness";
import { Context, Deferred, Effect, Layer, Match, Option, Queue, Stream } from "effect";
import { DaemonEnvironment } from "../home/daemon-environment.ts";
import { HostFiles } from "../home/host-files.ts";
import { CawHome } from "../home/caw-home.ts";
import { EventBus } from "../events/event-bus.ts";
import { InterceptorChains } from "../plugins/interceptor-chains.ts";
import { Registration, Registry } from "../plugins/registry.ts";
import { MessageMap } from "../store/message-map.ts";
import { Sessions } from "../store/sessions.ts";
import type { SessionInput, TurnFailure } from "./session-link.ts";
import { DeliverySignal, HarnessSignal, SessionLink } from "./session-link.ts";
import type { SessionTarget } from "./session-target.ts";

/** Caw's core skill, a local Claude plugin telling the agent to run `caw guide`. */

const none: ReadonlyArray<HarnessSignal> = [];

const cawPrompt = (target: SessionTarget) =>
  `You are Caw, talking with people through ${target.channel.name}. Write ${target.channel.markup}. Run \`caw guide\` to learn how to control Caw (schedules, memory, profiles, plugins).`;

const logChannelFailure = <A, R>(effect: Effect.Effect<A, ChannelError, R>) =>
  effect.pipe(
    Effect.catchTag("ChannelError", (error) =>
      Effect.logWarning("Channel operation failed", error),
    ),
  );

/** Builds the `SessionLink` that binds a Session machine's work to one Session. */
export class SessionLinks extends Context.Service<
  SessionLinks,
  {
    /** `inputs` is the Session's delivery queue. */
    readonly make: (
      target: SessionTarget,
      inputs: Queue.Queue<SessionInput>,
    ) => Effect.Effect<SessionLink["Service"]>;
  }
>()("@caw/core/SessionLinks") {
  static readonly layer = Layer.effect(
    SessionLinks,
    Effect.gen(function* () {
      const registry = yield* Registry;
      const chains = yield* InterceptorChains;
      const bus = yield* EventBus;
      const sessions = yield* Sessions;
      const messageMap = yield* MessageMap;
      const home = yield* CawHome;
      const files = yield* HostFiles;
      const environment = yield* DaemonEnvironment;

      return {
        make: Effect.fn("SessionLinks.make")(function* (
          target: SessionTarget,
          inputs: Queue.Queue<SessionInput>,
        ) {
          const opened = yield* Deferred.make<LiveSession>();
          const { channel, conversation, root, session, profile } = yield* Effect.succeed(target);
          const sessionId = session.id;

          const reply = Effect.fn("SessionLink.reply")(function* (text: string) {
            const outgoing = yield* chains.outboundReply(text, { conversation, session });

            if (Option.isNone(outgoing)) {
              return;
            }

            const messageIds = yield* channel.send(conversation.externalId, outgoing.value);

            yield* messageMap.record(conversation.id, messageIds, Option.some(sessionId));
            yield* bus.publish(
              CawEvent.ReplySent({
                conversationId: conversation.id,
                messageIds,
                text: outgoing.value,
              }),
            );
          }, logChannelFailure);

          const onHarnessEvent = (
            event: HarnessEvent,
          ): Effect.Effect<ReadonlyArray<HarnessSignal>> =>
            Effect.gen(function* () {
              yield* bus.publish(CawEvent.HarnessEventReceived({ sessionId, event }));

              return yield* Match.valueTags(event, {
                Text: ({ text }) => Effect.as(reply(text), none),
                ToolCall: () => Effect.succeed(none),
                ToolResult: () => Effect.succeed(none),
                CursorUpdated: ({ cursor }) =>
                  Effect.as(sessions.saveCursor(sessionId, cursor), none),
                TurnEnded: () =>
                  Effect.as(bus.publish(CawEvent.TurnEnded({ sessionId, outcome: "completed" })), [
                    HarnessSignal.cases.TurnCompleted.make({}),
                  ]),
                Failed: ({ error }) =>
                  Match.valueTags(error, {
                    SessionNotFound: () =>
                      Effect.succeed([HarnessSignal.cases.SessionMissing.make({})]),
                    HarnessError: ({ message }) =>
                      Effect.as(bus.publish(CawEvent.TurnEnded({ sessionId, outcome: "failed" })), [
                        HarnessSignal.cases.TurnFailed.make({ message }),
                      ]),
                  }),
              });
            });

          const open = Effect.gen(function* () {
            const harness = yield* registry.harness(Option.some(profile.harness));

            if (Option.isNone(harness)) {
              return yield* new HarnessError({
                harness: profile.harness,
                message: `No Harness named ${profile.harness} is registered.`,
                cause: undefined,
              });
            }

            const setup = yield* chains.sessionOpening({ conversation, root, session, profile });
            const registrations = yield* registry.all;
            const cwd = Option.getOrElse(profile.cwd, () => home.workspace(root.id));

            yield* files.ensureDirectory(cwd).pipe(Effect.orDie);

            const env = { ...environment.vars, ...profile.env, ...setup.env };

            const live = yield* harness.value.open({
              start: target.start,
              conversationId: conversation.id,
              rootConversationId: root.id,
              sessionId,
              profile,
              cwd,
              env: {
                ...env,
                // The agent runs `caw` through the shim the daemon wrote.
                PATH: [home.binDir, ...Option.toArray(Option.fromNullishOr(env["PATH"]))].join(":"),
                CAW_CONVERSATION_ID: conversation.id,
                CAW_SESSION_ID: sessionId,
              },
              systemPrompt: [cawPrompt(target), ...setup.systemPrompt],
              tools: setup.tools,
              skillDirs: [
                home.skillDir,
                ...registrations.flatMap((entry) =>
                  Registration.$is("SkillDir")(entry) ? [entry.path] : [],
                ),
              ],
              interceptToolCall: chains.toolCall,
            });

            yield* Deferred.succeed(opened, live);
            yield* bus.publish(CawEvent.SessionOpened({ session, start: target.start }));

            return Stream.concat(
              Stream.succeed(HarnessSignal.cases.Opened.make({})),
              live.events.pipe(Stream.mapEffect(onHarnessEvent), Stream.flattenIterable),
            );
          });

          const deliver = (input: SessionInput) =>
            Effect.gen(function* () {
              const live = yield* Deferred.await(opened);
              const text = yield* chains.turnInput(input.text, { conversation, session });

              yield* sessions.touch(sessionId);

              return yield* live.send(text).pipe(
                Effect.as(DeliverySignal.cases.InputDelivered.make({ input })),
                Effect.catch((error) =>
                  Effect.succeed(
                    DeliverySignal.cases.DeliveryFailed.make({ input, message: error.message }),
                  ),
                ),
              );
            });

          const react = (input: SessionInput, emoji: string) =>
            Effect.forEach(input.messages, (message) =>
              channel.react(message.conversation, message.id, emoji).pipe(logChannelFailure),
            );

          return SessionLink.of({
            harness: Stream.unwrap(open),
            deliveries: Stream.fromQueue(inputs).pipe(Stream.mapEffect(deliver)),
            turn: Effect.gen(function* () {
              yield* bus.publish(CawEvent.TurnStarted({ sessionId }));
              yield* channel.typing(conversation.externalId);

              return yield* Effect.never;
            }).pipe(Effect.scoped),
            stopTurn: (inFlight: ReadonlyArray<SessionInput>) =>
              Effect.gen(function* () {
                const live = yield* Deferred.await(opened);

                yield* live.interrupt.pipe(
                  Effect.catch((error) => Effect.logWarning("Interrupting the Turn failed", error)),
                );
                yield* Effect.forEach(inFlight, (input) => react(input, "⏹️"));
                yield* bus.publish(CawEvent.TurnEnded({ sessionId, outcome: "interrupted" }));
              }).pipe(Effect.uninterruptible),
            reportFailure: (failure: TurnFailure) =>
              Effect.gen(function* () {
                yield* Effect.forEach(failure.inFlight, (input) => react(input, "❌"));
                yield* channel
                  .send(conversation.externalId, `❌ The Turn failed: ${failure.message}`)
                  .pipe(logChannelFailure);
              }).pipe(Effect.uninterruptible),
          });
        }),
      };
    }),
  );
}
