import { renderGuide } from "@gloaming/core/guide";
import type { LoadedPlugin } from "@gloaming/core/loaded-plugin";
import { Console, Effect, Result } from "effect";
import { Argument, Command } from "effect/cli";
import { CliFailure } from "../cli-failure.ts";

/** `caw guide [topic]` over core's pages and every given Plugin's. */
export const guideCommand = (plugins: ReadonlyArray<LoadedPlugin>) =>
  Command.make("guide", { topic: Argument.String("topic").pipe(Argument.optional) }, ({ topic }) =>
    Result.match(renderGuide(plugins, topic), {
      onSuccess: (text) => Console.log(text),
      onFailure: (message) => Effect.fail(new CliFailure({ message })),
    }),
  ).pipe(Command.withDescription("List guide topics, or read one"));
