import type {
  Channel,
  ChannelCommandName,
  ChannelMessage,
  ConversationPlace,
} from "@gloaming/sdk/channel";
import { ChannelInput } from "@gloaming/sdk/channel";
import { ChannelMessageId, ChannelName, ExternalConversationId } from "@gloaming/sdk/ids";
import { Effect, Queue, Ref, Stream } from "effect";

export interface SentMessage {
  readonly conversation: string;
  readonly text: string;
}

export interface Reaction {
  readonly conversation: string;
  readonly message: string;
  readonly emoji: string;
}

/** A Channel driven by the test: it records everything core asks of it. */
export const makeFakeChannel = Effect.gen(function* () {
  const inputs = yield* Queue.unbounded<ChannelInput>();
  const sent = yield* Ref.make<ReadonlyArray<SentMessage>>([]);
  const reactions = yield* Ref.make<ReadonlyArray<Reaction>>([]);
  const threads = yield* Ref.make<ReadonlyArray<{ from: string; name: string }>>([]);
  const responses = yield* Ref.make<ReadonlyArray<string>>([]);
  const typing = yield* Ref.make(0);
  const history = yield* Ref.make<ReadonlyArray<ChannelMessage>>([]);
  const counter = yield* Ref.make(0);

  const channel: Channel = {
    name: ChannelName.make("fake"),
    markup: "plain text",
    inputs: Stream.fromQueue(inputs),
    send: (conversation, text) =>
      Effect.gen(function* () {
        const id = yield* Ref.updateAndGet(counter, (n) => n + 1);

        yield* Ref.update(sent, (all) => [...all, { conversation, text }]);

        return [ChannelMessageId.make(`sent-${id}`)];
      }),
    openThread: (_conversation, from, name) =>
      Effect.as(
        Ref.update(threads, (all) => [...all, { from, name }]),
        ExternalConversationId.make(`thread-${from}`),
      ),
    react: (conversation, message, emoji) =>
      Ref.update(reactions, (all) => [...all, { conversation, message, emoji }]),
    typing: () =>
      Effect.acquireRelease(
        Ref.update(typing, (n) => n + 1),
        () => Ref.update(typing, (n) => n - 1),
      ),
    history: () => Ref.get(history),
  };

  const say = (message: ChannelMessage) => Queue.offer(inputs, ChannelInput.Message({ message }));

  const command = (conversation: string, place: ConversationPlace, name: ChannelCommandName) =>
    Queue.offer(
      inputs,
      ChannelInput.Command({
        channel: channel.name,
        conversation: ExternalConversationId.make(conversation),
        place,
        command: name,
        respond: (text) => Ref.update(responses, (all) => [...all, text]),
      }),
    );

  return { channel, say, command, sent, reactions, threads, responses, typing, history };
});

export type FakeChannel = Effect.Success<typeof makeFakeChannel>;
