import { Machine } from "@typeonce/effect-machine";
import { Data, Match, Option, Schema, Stream } from "effect";
import {
  DeliverySignal,
  HarnessSignal,
  SessionInput,
  SessionLink,
  TurnFailure,
} from "./session-link.ts";

/** Why core closed a live Session (`SessionCloseReason` from the SDK). */
const CloseReason = Schema.Literals([
  "idle",
  "evicted",
  "reset",
  "profile-changed",
  "plugins-changed",
  "shutdown",
]);

const InFlight = { inFlight: Schema.Array(SessionInput) };

export const SessionStates = Machine.state({
  fields: { idleTimeoutMillis: Schema.Finite },
  states: {
    Open: {
      states: {
        Opening: {},
        Live: {
          states: {
            Idle: {},
            Running: { fields: InFlight },
            Stopping: { fields: InFlight },
            Failing: { fields: { failure: TurnFailure } },
          },
        },
      },
    },
    Closed: { type: "final", fields: { reason: CloseReason } },
    /** The Harness no longer knows the Session; `replay` is what it never answered. */
    Lost: { type: "final", fields: { replay: Schema.Array(SessionInput) } },
    /** The Harness session failed or ended on its own; `replay` is what it never answered. */
    Broken: {
      type: "final",
      fields: { message: Schema.String, replay: Schema.Array(SessionInput) },
    },
  },
});

export const SessionEvents = Machine.events({
  Interrupt: {},
  Close: { reason: CloseReason },
});

const harness = Stream.unwrap(SessionLink.useSync((link) => link.harness));
const deliveries = Stream.unwrap(SessionLink.useSync((link) => link.deliveries));
const turn = SessionLink.use((link) => link.turn);

const stopTurn = (inFlight: ReadonlyArray<SessionInput>) =>
  SessionLink.use((link) => link.stopTurn(inFlight));

const reportFailure = (failure: TurnFailure) =>
  SessionLink.use((link) => link.reportFailure(failure));

/**
 * One live Session: opening the Harness, idle between Turns, running a Turn
 * (inputs that arrive meanwhile Steer it), and how it ended.
 */
export const SessionMachine = Machine.make({
  id: "Session",
  root: SessionStates,
  events: SessionEvents,
  internalEvents: Machine.internalEventsFromSchemas(HarnessSignal, DeliverySignal),
  input: Schema.Struct({ idleTimeoutMillis: Schema.Finite }),
  streams: { harness, deliveries },
  effects: { turn, stopTurn, reportFailure },
  timers: { idleTimeout: (millis: number) => millis },
  branches: {
    harnessFailure: { lost: { target: "Lost" }, broken: { target: "Broken" } },
  },
}).handle({
  root: ({ input }) => ({ idleTimeoutMillis: input.idleTimeoutMillis }),
  initial: { target: "Open" },
  states: {
    Open: {
      initial: { target: "Open.Opening" },
      invoke: {
        src: "harness",
        onElement: {
          none: true,
          resolve: ({ element }, enqueue) => {
            enqueue.raise(element);
          },
        },
        onDone: {
          target: "Broken",
          data: () => ({ message: "The Harness session ended.", replay: [] }),
        },
        onFailure: {
          branches: "harnessFailure",
          resolve: ({ error, select }) =>
            Match.valueTags(error, {
              SessionNotFound: () => select.lost({ data: { replay: [] } }),
              HarnessError: ({ message }) => select.broken({ data: { message, replay: [] } }),
            }),
        },
      },
      on: {
        Close: { target: "Closed", data: ({ event }) => ({ reason: event.reason }) },
        SessionMissing: { target: "Lost", data: () => ({ replay: [] }) },
      },
      states: {
        Opening: { on: { Opened: { target: "Open.Live" } } },
        Live: {
          initial: { target: "Open.Live.Idle" },
          invoke: {
            src: "deliveries",
            onElement: {
              none: true,
              resolve: ({ element }, enqueue) => {
                enqueue.raise(element);
              },
            },
            onDone: { none: true },
          },
          on: {
            InputDelivered: {
              target: "Open.Live.Running",
              data: ({ event }) => ({ inFlight: [event.input] }),
            },
            DeliveryFailed: {
              target: "Open.Live.Failing",
              data: ({ event }) => ({
                failure: new TurnFailure({ inFlight: [event.input], message: event.message }),
              }),
            },
            TurnFailed: {
              target: "Open.Live.Failing",
              data: ({ event }) => ({
                failure: new TurnFailure({ inFlight: [], message: event.message }),
              }),
            },
          },
          states: {
            Idle: {
              invoke: {
                src: "idleTimeout",
                input: ({ root }) => root.idleTimeoutMillis,
                onDone: { target: "Closed", data: () => ({ reason: "idle" as const }) },
              },
            },
            Running: {
              invoke: { src: "turn" },
              on: {
                InputDelivered: {
                  update: "Open.Live.Running",
                  data: ({ state, event }) => ({ inFlight: [...state.inFlight, event.input] }),
                },
                TurnCompleted: { target: "Open.Live.Idle" },
                TurnFailed: {
                  target: "Open.Live.Failing",
                  data: ({ state, event }) => ({
                    failure: new TurnFailure({ inFlight: state.inFlight, message: event.message }),
                  }),
                },
                Interrupt: {
                  target: "Open.Live.Stopping",
                  data: ({ state }) => ({ inFlight: state.inFlight }),
                },
                SessionMissing: {
                  target: "Lost",
                  data: ({ state }) => ({ replay: state.inFlight }),
                },
              },
            },
            Stopping: {
              invoke: {
                src: "stopTurn",
                input: ({ state }) => state.inFlight,
                onDone: { target: "Open.Live.Idle" },
              },
            },
            Failing: {
              invoke: {
                src: "reportFailure",
                input: ({ state }) => state.failure,
                onDone: { target: "Open.Live.Idle" },
              },
            },
          },
        },
      },
    },
    Closed: {},
    Lost: {},
    Broken: {},
  },
});

/** How a Session machine ended. */
export type SessionEnding = Data.TaggedEnum<{
  Closed: { readonly reason: typeof CloseReason.Type };
  Lost: { readonly replay: ReadonlyArray<SessionInput> };
  Broken: { readonly message: string; readonly replay: ReadonlyArray<SessionInput> };
}>;

export const SessionEnding = Data.taggedEnum<SessionEnding>();

type SessionState = Parameters<typeof SessionStates.get>[0];

/** Reads the final state of a finished machine; a machine stopped from outside counts as broken. */
export const endingOf = (state: SessionState): SessionEnding =>
  SessionStates.get(state, "Closed").pipe(
    Option.map(({ reason }) => SessionEnding.Closed({ reason })),
    Option.orElse(() =>
      Option.map(SessionStates.get(state, "Lost"), ({ replay }) => SessionEnding.Lost({ replay })),
    ),
    Option.orElse(() =>
      Option.map(SessionStates.get(state, "Broken"), ({ message, replay }) =>
        SessionEnding.Broken({ message, replay }),
      ),
    ),
    Option.getOrElse(() =>
      SessionEnding.Broken({ message: "The Session stopped unexpectedly.", replay: [] }),
    ),
  );
