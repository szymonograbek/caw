import { CurrentCliContext, fromCommand } from "@gloaming/caw-plugin-sdk/cli-command";
import type { Conversation } from "@gloaming/caw-plugin-sdk/conversation";
import { ReplyMode } from "@gloaming/caw-plugin-sdk/conversation";
import { ConversationId, ProfileName } from "@gloaming/caw-plugin-sdk/ids";
import { CliCommandError } from "@gloaming/caw-plugin-sdk/plugin";
import { defaultProfileName } from "@gloaming/caw-plugin-sdk/profile";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { Registration, Registry } from "../plugins/registry.ts";
import { ConversationPlaces } from "../routing/conversation-places.ts";
import { Conversations } from "../store/conversations.ts";
import { Sessions } from "../store/sessions.ts";

const conversationFlag = Flag.String("conversation").pipe(
  Flag.withSchema(ConversationId),
  Flag.optional,
  Flag.withDescription("The Conversation id; defaults to CAW_CONVERSATION_ID"),
);

const failWith = (message: string) => Effect.fail(new CliCommandError({ message }));

const describeConversation = (conversation: Conversation) =>
  `${conversation.id} (${conversation.channel} ${conversation.externalId})`;

/** Core's `caw conversation set | show`: the top-level Conversation's profile and Reply mode. */
export const conversationCommand = Effect.gen(function* () {
  const conversations = yield* Conversations;
  const places = yield* ConversationPlaces;
  const sessions = yield* Sessions;
  const registry = yield* Registry;

  /** The named Conversation, or the one the invoking Session runs in. */
  const resolve = Effect.fn("ConversationCommand.resolve")(function* (
    flag: Option.Option<ConversationId>,
  ) {
    const context = yield* CurrentCliContext;
    const id = Option.orElse(flag, () => context.conversationId);

    if (Option.isNone(id)) {
      return yield* failWith("Pass --conversation <id>; there is no CAW_CONVERSATION_ID here.");
    }

    const found = yield* conversations.get(id.value);

    if (Option.isNone(found)) {
      return yield* failWith(`No conversation ${id.value}.`);
    }

    return found.value;
  });

  const profileExists = Effect.fn("ConversationCommand.profileExists")(function* (
    name: ProfileName,
  ) {
    const lookups = (yield* registry.all).filter(Registration.$is("Profiles"));
    const found = yield* Effect.forEach(lookups, (entry) => entry.lookup(name));

    return name === defaultProfileName || found.some(Option.isSome);
  });

  const set = Command.make(
    "set",
    {
      conversation: conversationFlag,
      profile: Flag.String("profile").pipe(
        Flag.withSchema(ProfileName),
        Flag.optional,
        Flag.withDescription("The Harness profile; the next message starts a new Session"),
      ),
      replyMode: Flag.Literals("reply-mode", ReplyMode.literals).pipe(
        Flag.optional,
        Flag.withDescription("threaded: a thread per top-level message; inline: one Session"),
      ),
    },
    ({ conversation, profile, replyMode }) =>
      Effect.gen(function* () {
        if (Option.isNone(profile) && Option.isNone(replyMode)) {
          return yield* failWith("Pass --profile <name> and/or --reply-mode threaded|inline.");
        }

        // Threads inherit both settings, so they always live on the top-level Conversation.
        const found = yield* resolve(conversation);
        const root = yield* places.root(found);
        const lines: Array<string> = [];

        if (Option.isSome(profile)) {
          if (!(yield* profileExists(profile.value))) {
            return yield* failWith(`No profile named ${profile.value}. Run \`caw profile list\`.`);
          }

          yield* conversations.setProfile(root.id, profile);
          lines.push(
            `Profile of ${root.id} is now ${profile.value}; its next message starts a new Session.`,
          );
        }

        if (Option.isSome(replyMode)) {
          yield* conversations.setReplyMode(root.id, replyMode.value);
          lines.push(`Reply mode of ${root.id} is now ${replyMode.value}.`);
        }

        return yield* Console.log(lines.join("\n"));
      }),
  ).pipe(Command.withDescription("Change the Conversation's profile or Reply mode"));

  const show = Command.make("show", { conversation: conversationFlag }, ({ conversation }) =>
    Effect.gen(function* () {
      const found = yield* resolve(conversation);
      const root = yield* places.root(found);
      const current = yield* sessions.current(found.id);

      yield* Console.log(
        [
          `Conversation ${describeConversation(found)}`,
          ...(root.id === found.id ? [] : [`Thread of ${describeConversation(root)}`]),
          `Reply mode: ${root.replyMode}`,
          `Profile: ${Option.getOrElse(root.profile, () => `${defaultProfileName} (not set)`)}`,
          Option.match(current, {
            onNone: () => "Session: none yet",
            onSome: ({ session }) =>
              `Session: ${session.id} (${session.status}, profile ${session.profile})`,
          }),
        ].join("\n"),
      );
    }),
  ).pipe(Command.withDescription("Show the Conversation's settings and current Session"));

  return fromCommand(
    Command.make("conversation").pipe(
      Command.withDescription("Show or change Conversation settings"),
      Command.withSubcommands([set, show]),
    ),
    "Show or change Conversation settings",
  );
});
