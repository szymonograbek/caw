import { ChannelMessageId, ExternalConversationId } from "@caw/sdk/ids";
import type { HarnessError, SessionNotFound } from "@caw/sdk/harness";
import type { Effect, Stream } from "effect";
import { Context, Schema } from "effect";

/** A Channel message by where it lives; a thread's first message lives in the parent Room. */
export class MessageRef extends Schema.Class<MessageRef, { readonly brand: unique symbol }>(
  "MessageRef",
)({
  conversation: ExternalConversationId,
  id: ChannelMessageId,
}) {}

/** One formatted input bound for a Session, with the Channel messages that triggered it. */
export class SessionInput extends Schema.Class<SessionInput, { readonly brand: unique symbol }>(
  "SessionInput",
)({
  text: Schema.String,
  messages: Schema.Array(MessageRef),
}) {}

/** A Turn that failed, with the inputs whose messages get the ❌ reaction. */
export class TurnFailure extends Schema.Class<TurnFailure, { readonly brand: unique symbol }>(
  "TurnFailure",
)({
  inFlight: Schema.Array(SessionInput),
  message: Schema.String,
}) {}

/** What a live Harness session reports to its Session machine. */
export const HarnessSignal = Schema.TaggedUnion({
  Opened: {},
  TurnCompleted: {},
  TurnFailed: { message: Schema.String },
  SessionMissing: {},
});

export type HarnessSignal = typeof HarnessSignal.Type;

/** What delivering one input to the Harness reports to its Session machine. */
export const DeliverySignal = Schema.TaggedUnion({
  InputDelivered: { input: SessionInput },
  DeliveryFailed: { input: SessionInput, message: Schema.String },
});

export type DeliverySignal = typeof DeliverySignal.Type;

/**
 * The work one Session machine runs, bound to one Session. The machine decides
 * when each runs; the link knows how.
 */
export class SessionLink extends Context.Service<
  SessionLink,
  {
    /** Opens the Harness session for the stream's lifetime and reports what it does. */
    readonly harness: Stream.Stream<HarnessSignal, HarnessError | SessionNotFound>;
    /** Sends queued inputs to the opened Harness session, in order. */
    readonly deliveries: Stream.Stream<DeliverySignal>;
    /** Holds the typing indicator and announces the Turn for as long as it runs. */
    readonly turn: Effect.Effect<never>;
    readonly stopTurn: (inFlight: ReadonlyArray<SessionInput>) => Effect.Effect<void>;
    readonly reportFailure: (failure: TurnFailure) => Effect.Effect<void>;
  }
>()("@caw/core/SessionLink") {}
