import { describe, expect, it } from "@effect/vitest";
import type { ChannelMessage } from "@omen/sdk/channel";
import { Conversation } from "@omen/sdk/conversation";
import { ToolCallDecision } from "@omen/sdk/harness";
import { ConversationId, PluginName, SessionId } from "@omen/sdk/ids";
import { InboundDecision, Interceptor } from "@omen/sdk/interceptors";
import { Effect, Layer, Option, Ref } from "effect";
import { message } from "../testing/test-daemon.ts";
import { InterceptorChains } from "./interceptor-chains.ts";
import { Registration, Registry } from "./registry.ts";

const chains = InterceptorChains.layer.pipe(Layer.provideMerge(Registry.layer));

const conversation = new Conversation({
  id: ConversationId.make("c1"),
  channel: message("room", "m1", "").channel,
  externalId: message("room", "m1", "").conversation,
  parentId: Option.none(),
  replyMode: "threaded",
  profile: Option.none(),
});

const register = (plugin: string, interceptor: Interceptor) =>
  Registry.use((registry) =>
    registry.add(Registration.Interceptor({ plugin: PluginName.make(plugin), interceptor })),
  );

const inbound = (decide: (message: ChannelMessage) => InboundDecision, seen: Ref.Ref<number>) =>
  Interceptor.InboundMessage({
    handle: (received) =>
      Effect.as(
        Ref.update(seen, (n) => n + 1),
        decide(received),
      ),
  });

describe("InterceptorChains", () => {
  it.effect("folds in Plugin order and stops at Drop", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make(0);
      const registry = yield* Registry;
      const run = yield* InterceptorChains;

      yield* registry.setOrder([PluginName.make("a"), PluginName.make("b"), PluginName.make("c")]);
      yield* register(
        "c",
        inbound(() => InboundDecision.Continue(), seen),
      );
      yield* register(
        "b",
        inbound(() => InboundDecision.Drop(), seen),
      );
      yield* register(
        "a",
        inbound(
          (received) => InboundDecision.Transform({ message: { ...received, text: "x" } }),
          seen,
        ),
      );

      expect(yield* run.inbound(message("room", "m1", "hi"), conversation)).toEqual(Option.none());
      expect(yield* Ref.get(seen)).toBe(2);
    }).pipe(Effect.provide(chains), Effect.scoped),
  );

  it.effect("stops at Handled and passes transformed messages along", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make(0);
      const texts = yield* Ref.make<ReadonlyArray<string>>([]);
      const run = yield* InterceptorChains;

      yield* register(
        "a",
        inbound(
          (received) => InboundDecision.Transform({ message: { ...received, text: "changed" } }),
          seen,
        ),
      );
      yield* register(
        "b",
        Interceptor.InboundMessage({
          handle: (received) =>
            Effect.as(
              Ref.update(texts, (all) => [...all, received.text]),
              InboundDecision.Handled(),
            ),
        }),
      );
      yield* register(
        "c",
        inbound(() => InboundDecision.Continue(), seen),
      );

      expect(yield* run.inbound(message("room", "m1", "hi"), conversation)).toEqual(Option.none());
      expect(yield* Ref.get(texts)).toEqual(["changed"]);
      expect(yield* Ref.get(seen)).toBe(1);
    }).pipe(Effect.provide(chains), Effect.scoped),
  );

  it.effect("stops a tool call at Block and keeps earlier mutations otherwise", () =>
    Effect.gen(function* () {
      const run = yield* InterceptorChains;
      const request = { sessionId: SessionId.make("s1"), name: "Bash", input: { command: "ls" } };

      yield* register(
        "a",
        Interceptor.ToolCall({
          handle: () => Effect.succeed(ToolCallDecision.Mutate({ input: { command: "ls -la" } })),
        }),
      );
      expect(yield* run.toolCall(request)).toEqual(
        ToolCallDecision.Mutate({ input: { command: "ls -la" } }),
      );

      yield* register(
        "b",
        Interceptor.ToolCall({
          handle: (call) => Effect.succeed(ToolCallDecision.Block({ reason: `no ${call.name}` })),
        }),
      );
      expect(yield* run.toolCall(request)).toEqual(ToolCallDecision.Block({ reason: "no Bash" }));
    }).pipe(Effect.provide(chains), Effect.scoped),
  );
});
