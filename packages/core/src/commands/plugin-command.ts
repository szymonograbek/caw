import * as NodePath from "node:path";
import { CurrentCliContext, fromCommand } from "@omen/sdk/cli-command";
import { PluginName } from "@omen/sdk/ids";
import { CliCommandError } from "@omen/sdk/plugin";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command } from "effect/cli";
import type { PluginEntry } from "../plugins/plugin-host.ts";
import { PluginHost } from "../plugins/plugin-host.ts";
import { describePluginState } from "../plugins/plugin-state.ts";

const pluginName = Argument.String("name").pipe(Argument.withSchema(PluginName));

/** `bun add` runs in a staging folder, so a relative path must be made absolute first. */
export const resolvePluginSource = (source: string, cwd: string): string =>
  source.startsWith(".") || source.startsWith("/") ? NodePath.resolve(cwd, source) : source;

const describeEntries = (entries: ReadonlyArray<PluginEntry>): string => {
  const width = Math.max(...entries.map(({ row }) => row.name.length));

  return entries
    .map(({ row, state }) => {
      const origin = row.source === "builtin" ? "built in" : `${row.source} ${row.version}`;

      return `${row.name.padEnd(width)}  ${describePluginState(state)}  (${origin})`;
    })
    .join("\n");
};

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

/** `key=value`; a value that parses as JSON is used as JSON, anything else as a string. */
const parseSetting = (pair: string) => {
  const split = pair.indexOf("=");

  if (split <= 0) {
    return Effect.fail(new CliCommandError({ message: `Expected key=value, got: ${pair}` }));
  }

  const raw = pair.slice(split + 1);

  const value: Schema.Json = Option.getOrElse(decodeJson(raw), () => raw);

  return Effect.succeed([pair.slice(0, split), value] as const);
};

const decodeSettings = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json));

const failWith = (message: string) => Effect.fail(new CliCommandError({ message }));

const notFound = ({ plugin }: { readonly plugin: string }) =>
  failWith(`No plugin named ${plugin}. Run \`omen plugin list\`.`);

/** Settings and Plugin changes close live Sessions; they resume on their next message. */
const resumeNote = "Live Sessions were closed; each resumes on its next message.";

/** Core's `omen plugin …`: install, remove, toggle, order and configure Plugins. */
export const pluginCommand = Effect.gen(function* () {
  const host = yield* PluginHost;

  const add = Command.make("add", { source: Argument.String("source") }, ({ source }) =>
    Effect.gen(function* () {
      const { cwd } = yield* CurrentCliContext;
      const name = yield* host.install(resolvePluginSource(source, cwd));

      yield* Console.log(`Installed plugin ${name} and enabled it. ${resumeNote}`);
    }).pipe(Effect.catchTag("PluginInstallError", ({ message }) => failWith(message))),
  ).pipe(Command.withDescription("Install a plugin from a git URL, an npm name or a path"));

  const remove = Command.make("remove", { name: pluginName }, ({ name }) =>
    host.remove(name).pipe(
      Effect.andThen(Console.log(`Removed plugin ${name}.`)),
      Effect.catchTags({
        PluginNotFound: notFound,
        BuiltinPluginNotRemovable: () =>
          failWith(`${name} is built in; disable it instead: omen plugin disable ${name}`),
        PluginInstallError: ({ message }) => failWith(message),
      }),
    ),
  ).pipe(Command.withDescription("Uninstall an installed plugin"));

  const enable = Command.make("enable", { name: pluginName }, ({ name }) =>
    host
      .enable(name)
      .pipe(
        Effect.andThen(Console.log(`Enabled plugin ${name}. ${resumeNote}`)),
        Effect.catchTag("PluginNotFound", notFound),
      ),
  ).pipe(Command.withDescription("Enable a plugin"));

  const disable = Command.make("disable", { name: pluginName }, ({ name }) =>
    host
      .disable(name)
      .pipe(
        Effect.andThen(Console.log(`Disabled plugin ${name}. ${resumeNote}`)),
        Effect.catchTag("PluginNotFound", notFound),
      ),
  ).pipe(Command.withDescription("Disable a plugin"));

  const order = Command.make(
    "order",
    { names: pluginName.pipe(Argument.atLeast(1)) },
    ({ names }) =>
      Effect.gen(function* () {
        yield* host.order(names);

        const entries = yield* host.list;

        yield* Console.log(`Plugin order: ${entries.map(({ row }) => row.name).join(", ")}`);
      }).pipe(Effect.catchTag("PluginNotFound", notFound)),
  ).pipe(Command.withDescription("Move the named plugins to the front of plugin order"));

  const list = Command.make("list", {}, () =>
    Effect.gen(function* () {
      const entries = yield* host.list;

      yield* Console.log(entries.length === 0 ? "No plugins." : describeEntries(entries));
    }),
  ).pipe(Command.withDescription("List plugins in plugin order"));

  const set = Command.make(
    "set",
    { name: pluginName, settings: Argument.String("key=value").pipe(Argument.atLeast(1)) },
    ({ name, settings }) =>
      Effect.gen(function* () {
        const entry = (yield* host.list).find(({ row }) => row.name === name);

        if (entry === undefined) {
          return yield* notFound({ plugin: name });
        }

        const base = Option.getOrElse(decodeSettings(entry.row.settings), () => ({}));
        const changes = yield* Effect.forEach(settings, parseSetting);

        yield* host.configure(name, { ...base, ...Object.fromEntries(changes) });

        return yield* Console.log(`Updated settings of ${name}. ${resumeNote}`);
      }).pipe(
        Effect.catchTags({
          PluginNotFound: notFound,
          InvalidPluginSettings: ({ message }) => failWith(`Invalid settings: ${message}`),
        }),
      ),
  ).pipe(Command.withDescription("Change plugin settings, e.g. allowedReactions='[\"👀\"]'"));

  return fromCommand(
    Command.make("plugin").pipe(
      Command.withDescription("Manage plugins"),
      Command.withSubcommands([add, remove, enable, disable, order, list, set]),
    ),
    "Manage plugins",
  );
});
