import { ConfigProvider, Context, Effect, Layer, Option } from "effect";
import { HostFiles } from "./host-files.ts";
import { parseDotEnv } from "./env-file.ts";
import { OmenHome } from "./omen-home.ts";

/**
 * The daemon's environment: `<home>/.env` overlaid by the process environment.
 * Sessions inherit it, and every `Config` read in the daemon resolves against it.
 */
export class DaemonEnvironment extends Context.Service<
  DaemonEnvironment,
  { readonly vars: Readonly<Record<string, string>> }
>()("@omen/core/DaemonEnvironment") {
  /** `process` holds the variables Bun started with; this is the one place core reads them. */
  static readonly layer = Layer.effect(
    DaemonEnvironment,
    Effect.gen(function* () {
      const files = yield* HostFiles;
      const home = yield* OmenHome;
      const contents = yield* files.readText(home.envFile);

      return { vars: { ...parseDotEnv(Option.getOrElse(contents, () => "")), ...processVars() } };
    }).pipe(Effect.orDie),
  );

  /** Makes `Config` reads (plugin tokens such as `DISCORD_TOKEN`) see the `.env` file. */
  static readonly configProvider = Layer.unwrap(
    DaemonEnvironment.useSync(({ vars }) =>
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...vars } })),
    ),
  );
}

const processVars = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value] as const],
    ),
  );
