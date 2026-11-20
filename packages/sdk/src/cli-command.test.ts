import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { describe, expect, it } from "vitest";
import { CurrentCliContext, fromCommand } from "./cli-command.ts";
import { ConversationId } from "./ids.ts";
import { CliCommandError } from "./plugin.ts";

const greet = Command.make(
  "greet",
  {
    shout: Flag.Boolean("shout").pipe(Flag.withDefault(false)),
    name: Argument.String("name"),
  },
  ({ shout, name }) =>
    Effect.gen(function* () {
      const { conversationId } = yield* CurrentCliContext;
      const greeting = `Hello, ${name}! (${Option.getOrElse(conversationId, () => "no conversation")})`;
      yield* Console.log(shout ? greeting.toUpperCase() : greeting);
    }),
).pipe(Command.withDescription("Greets someone"));

const refuse = Command.make("refuse", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("thinking");

    return yield* new CliCommandError({ message: "no way" });
  }),
);

const app = fromCommand(
  Command.make("demo").pipe(Command.withSubcommands([greet, refuse])),
  "A demo command",
);

const outside = { conversationId: Option.none(), cwd: "/tmp" };
const inside = { conversationId: Option.some(ConversationId.make("c-1")), cwd: "/tmp" };

describe("fromCommand", () => {
  it("parses flags and arguments, and returns what the handler printed", async () => {
    const output = await Effect.runPromise(app.run(["greet", "--shout", "Ada"], inside));

    expect(output).toBe("HELLO, ADA! (C-1)");
  });

  it("gives handlers the invocation's CliContext", async () => {
    const output = await Effect.runPromise(app.run(["greet", "Ada"], outside));

    expect(output).toBe("Hello, Ada! (no conversation)");
  });

  it("returns help text for --help", async () => {
    const output = await Effect.runPromise(app.run(["greet", "--help"], outside));

    expect(output).toContain("Greets someone");
    expect(output).toContain("--shout");
  });

  it("returns help for a command group invoked without a subcommand", async () => {
    const output = await Effect.runPromise(app.run([], outside));

    expect(output).toContain("greet");
    expect(output).toContain("refuse");
  });

  it("fails with a CliCommandError holding help and the error for an unknown flag", async () => {
    const error = await Effect.runPromise(
      Effect.flip(app.run(["greet", "--loud", "Ada"], outside)),
    );

    expect(error).toBeInstanceOf(CliCommandError);
    expect(error.message).toContain("--loud");
    expect(error.message).toContain("Greets someone");
  });

  it("keeps the handler's output in front of its CliCommandError", async () => {
    const error = await Effect.runPromise(Effect.flip(app.run(["refuse"], outside)));

    expect(error.message).toBe("thinking\nno way");
  });
});
