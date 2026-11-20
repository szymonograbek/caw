import type { ChannelMessage } from "@gloaming/sdk/channel";
import type { Conversation } from "@gloaming/sdk/conversation";
import type { ToolCallRequest } from "@gloaming/sdk/harness";
import { ToolCallDecision } from "@gloaming/sdk/harness";
import type { PluginName } from "@gloaming/sdk/ids";
import type {
  OutboundReplyContext,
  SessionOpeningContext,
  TurnInputContext,
} from "@gloaming/sdk/interceptors";
import { Interceptor } from "@gloaming/sdk/interceptors";
import type { Tool, ToolGroup } from "@gloaming/sdk/tool";
import { Context, Effect, Layer, Match, Option } from "effect";
import { Registration, Registry } from "./registry.ts";

/** What the enabled Plugins add to a Session as it opens. */
export interface SessionSetup {
  readonly systemPrompt: ReadonlyArray<string>;
  readonly tools: ReadonlyArray<ToolGroup>;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Core's interception points. Each runs the enabled Plugins' handlers in
 * Plugin order and stops at the first `Drop`, `Handled` or `Block`.
 */
export class InterceptorChains extends Context.Service<
  InterceptorChains,
  {
    /** `None` when an interceptor dropped or handled the message. */
    readonly inbound: (
      message: ChannelMessage,
      conversation: Conversation,
    ) => Effect.Effect<Option.Option<ChannelMessage>>;
    readonly sessionOpening: (context: SessionOpeningContext) => Effect.Effect<SessionSetup>;
    readonly turnInput: (input: string, context: TurnInputContext) => Effect.Effect<string>;
    readonly toolCall: (request: ToolCallRequest) => Effect.Effect<ToolCallDecision>;
    /** `None` when an interceptor dropped the reply. */
    readonly outboundReply: (
      text: string,
      context: OutboundReplyContext,
    ) => Effect.Effect<Option.Option<string>>;
  }
>()("@gloaming/core/InterceptorChains") {
  static readonly layer = Layer.effect(
    InterceptorChains,
    Effect.gen(function* () {
      const registry = yield* Registry;

      const interceptors = <Tag extends Interceptor["_tag"]>(tag: Tag) =>
        Effect.map(registry.all, (entries) =>
          entries.flatMap((entry) =>
            Registration.$is("Interceptor")(entry) && Interceptor.$is(tag)(entry.interceptor)
              ? [{ plugin: entry.plugin, interceptor: entry.interceptor }]
              : [],
          ),
        );

      const inbound = Effect.fn("InterceptorChains.inbound")(function* (
        message: ChannelMessage,
        conversation: Conversation,
      ) {
        let current = message;

        const chain = yield* interceptors("InboundMessage");

        for (const { interceptor } of chain) {
          const decision = yield* interceptor.handle(current, conversation);

          const next = Match.valueTags(decision, {
            Continue: () => Option.some(current),
            Transform: ({ message: transformed }) => Option.some(transformed),
            Drop: () => Option.none(),
            Handled: () => Option.none(),
          });

          if (Option.isNone(next)) {
            return next;
          }

          current = next.value;
        }

        return Option.some(current);
      });

      const sessionOpening = Effect.fn("InterceptorChains.sessionOpening")(function* (
        context: SessionOpeningContext,
      ) {
        const entries = yield* registry.all;

        const openers = yield* interceptors("SessionOpening");

        const contributions = yield* Effect.forEach(openers, ({ plugin, interceptor }) =>
          Effect.map(interceptor.handle(context), (contribution) => ({ plugin, contribution })),
        );

        const toolsByPlugin = new Map<PluginName, ReadonlyArray<Tool>>();

        const addTools = (plugin: PluginName, tools: ReadonlyArray<Tool>) =>
          toolsByPlugin.set(plugin, [...(toolsByPlugin.get(plugin) ?? []), ...tools]);

        for (const entry of entries) {
          if (Registration.$is("Tool")(entry)) {
            addTools(entry.plugin, [entry.tool]);
          }
        }

        const env: Record<string, string> = {};

        for (const { plugin, contribution } of contributions) {
          addTools(plugin, contribution.tools);
          Object.assign(env, contribution.env);
        }

        return {
          systemPrompt: contributions.flatMap(({ contribution }) => contribution.systemPrompt),
          tools: [...toolsByPlugin].map(([plugin, tools]) => ({ plugin, tools })),
          env,
        };
      });

      const turnInput = Effect.fn("InterceptorChains.turnInput")(function* (
        input: string,
        context: TurnInputContext,
      ) {
        let current = input;

        const chain = yield* interceptors("TurnInput");

        for (const { interceptor } of chain) {
          current = yield* interceptor.handle(current, context);
        }

        return current;
      });

      const toolCall = Effect.fn("InterceptorChains.toolCall")(function* (
        request: ToolCallRequest,
      ) {
        let current = request;
        let mutated = false;

        const chain = yield* interceptors("ToolCall");

        for (const { interceptor } of chain) {
          const decision = yield* interceptor.handle(current);

          if (ToolCallDecision.$is("Block")(decision)) {
            return decision;
          }

          if (ToolCallDecision.$is("Mutate")(decision)) {
            current = { sessionId: current.sessionId, name: current.name, input: decision.input };
            mutated = true;
          }
        }

        return mutated
          ? ToolCallDecision.Mutate({ input: current.input })
          : ToolCallDecision.Allow();
      });

      const outboundReply = Effect.fn("InterceptorChains.outboundReply")(function* (
        text: string,
        context: OutboundReplyContext,
      ) {
        let current = text;

        const chain = yield* interceptors("OutboundReply");

        for (const { interceptor } of chain) {
          const decision = yield* interceptor.handle(current, context);

          const next = Match.valueTags(decision, {
            Continue: () => Option.some(current),
            Transform: ({ text: transformed }) => Option.some(transformed),
            Drop: () => Option.none(),
          });

          if (Option.isNone(next)) {
            return next;
          }

          current = next.value;
        }

        return Option.some(current);
      });

      return { inbound, sessionOpening, turnInput, toolCall, outboundReply };
    }),
  );
}
