import { PassThrough } from "node:stream";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { WizardUi } from "./wizard-ui.ts";

/** Runs `use` against clack on in-memory streams, typing `keys` once it waits for input. */
const typing = <A, E>(keys: string, use: (ui: WizardUi["Service"]) => Effect.Effect<A, E>) => {
  const input = new PassThrough();
  const output = new PassThrough();
  let drawn = "";

  output.on("data", (chunk: Buffer) => {
    drawn += chunk.toString();
  });

  return WizardUi.use(use).pipe(
    Effect.provide(WizardUi.on(input, output)),
    Effect.forkChild,
    Effect.flatMap((fiber) =>
      Effect.andThen(
        Effect.sync(() => input.write(keys)),
        Effect.map(Effect.exit(Fiber.join(fiber)), (exit) => ({ exit, drawn })),
      ),
    ),
  );
};

describe("WizardUi", () => {
  it.live("turns Ctrl-C at a prompt into Setup cancelled.", () =>
    Effect.gen(function* () {
      const { exit } = yield* typing("\x03", (ui) =>
        ui.select(
          "Channel",
          [{ value: "discord", title: "Discord", hint: "Discord bot" }],
          "discord",
        ),
      );

      expect(exit).toEqual(Exit.fail(expect.objectContaining({ message: "Setup cancelled." })));
    }),
  );

  it.live("lists every option with its hint, one per line", () =>
    Effect.gen(function* () {
      const { exit, drawn } = yield* typing("\r", (ui) =>
        ui.select(
          "Claude model",
          [
            { value: "sonnet", title: "Sonnet", hint: "fast and capable" },
            { value: "opus", title: "Opus", hint: "most capable" },
          ],
          "sonnet",
        ),
      );

      expect(exit).toEqual(Exit.succeed("sonnet"));
      expect(drawn).toMatch(/Sonnet.*\(fast and capable\)/);
      expect(drawn).toMatch(/\n.*Opus.*\(most capable\)/);
    }),
  );
});
