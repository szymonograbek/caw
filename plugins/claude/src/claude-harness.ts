import type { Options, SDKUserMessage, SettingSource } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Cause } from "effect";
import { Effect, FiberSet, Option, Predicate, Queue, Schema, Stream } from "effect";
import type { Harness, HarnessError, OpenSession } from "@omen/sdk/harness";
import { HarnessEvent, SessionStart } from "@omen/sdk/harness";
import { claudeError, claudeHarnessName } from "./claude-error.ts";
import { decodeCursor } from "./cursor.ts";
import { toHarnessEvents } from "./events.ts";
import { preToolUse } from "./pre-tool-use.ts";
import { toolServers } from "./tool-servers.ts";

const defaultSettingSources: ReadonlyArray<SettingSource> = ["user", "project", "local"];

const decodeSettingSources = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Literals(["user", "project", "local"])),
);

const userMessage = (text: string): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
});

const isSessionNotFound = (event: HarnessEvent) =>
  Predicate.isTagged(event, "Failed") && Predicate.isTagged(event.error, "SessionNotFound");

/** Where the Claude Code session starts from. */
const startOptions = (
  start: SessionStart,
): Effect.Effect<Pick<Options, "resume" | "forkSession">, HarnessError> =>
  SessionStart.$match(start, {
    New: () => Effect.succeed({}),
    Resume: ({ cursor }) => decodeCursor(cursor).pipe(Effect.map((resume) => ({ resume }))),
    Fork: ({ cursor }) =>
      decodeCursor(cursor).pipe(Effect.map((resume) => ({ resume, forkSession: true }))),
  });

const open = Effect.fn("ClaudeHarness.open")(function* (request: OpenSession) {
  const runPromise = yield* FiberSet.makeRuntimePromise();
  const start = yield* startOptions(request.start);

  const settingSources = yield* Option.match(request.profile.settingSources, {
    onNone: () => Effect.succeed(defaultSettingSources),
    onSome: (sources) =>
      decodeSettingSources(sources).pipe(
        Effect.mapError((issue) => claudeError(`Invalid settingSources: ${issue.message}`, issue)),
      ),
  });

  const mcpServers = yield* toolServers(
    request.tools,
    {
      conversationId: request.conversationId,
      rootConversationId: request.rootConversationId,
      sessionId: request.sessionId,
    },
    runPromise,
  );

  const input = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();

  const options: Options = {
    ...start,
    ...Option.match(request.profile.model, { onNone: () => ({}), onSome: (model) => ({ model }) }),
    cwd: request.cwd,
    env: request.env,
    settingSources: [...settingSources],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: request.systemPrompt.join("\n\n"),
    },
    mcpServers,
    plugins: request.skillDirs.map((path) => ({ type: "local", path })),
    hooks: {
      PreToolUse: [{ hooks: [(hookInput) => runPromise(preToolUse(request, hookInput))] }],
    },
  };

  const session = yield* Effect.acquireRelease(
    Effect.try({
      try: () => query({ prompt: Stream.toAsyncIterable(Stream.fromQueue(input)), options }),
      catch: (cause) => claudeError("Claude Code failed to start", cause),
    }),
    (started) => Queue.end(input).pipe(Effect.andThen(Effect.sync(() => started.close()))),
  );

  return {
    send: (text: string) =>
      Queue.offer(input, userMessage(text)).pipe(
        Effect.flatMap((accepted) =>
          accepted ? Effect.void : Effect.fail(claudeError("The Session is closed", undefined)),
        ),
      ),
    interrupt: Effect.tryPromise({
      try: () => session.interrupt(),
      catch: (cause) => claudeError("Interrupting Claude Code failed", cause),
    }).pipe(Effect.andThen(Effect.void)),
    events: Stream.fromAsyncIterable(session, (cause) =>
      claudeError("Claude Code stopped unexpectedly", cause),
    ).pipe(
      Stream.mapAccum(() => Option.none(), toHarnessEvents),
      Stream.catch((error) => Stream.make(HarnessEvent.Failed({ error }))),
      // The CLI exits after a failed resume, so nothing follows.
      Stream.takeUntil(isSessionNotFound),
    ),
  };
});

export const claudeHarness: Harness = { name: claudeHarnessName, open };
