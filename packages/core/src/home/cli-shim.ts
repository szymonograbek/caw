import * as NodePath from "node:path";
import { Effect } from "effect";
import { HostFiles } from "./host-files.ts";
import { OmenHome } from "./omen-home.ts";

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * Writes `<home>/bin/omen`: it runs the CLI with the Bun running this daemon,
 * against this `OMEN_HOME`, so an agent's shell reaches the same daemon.
 */
export const writeCliShim = Effect.fn("writeCliShim")(function* (cliEntry: string) {
  const home = yield* OmenHome;
  const files = yield* HostFiles;
  const shim = NodePath.join(home.binDir, "omen");

  yield* files.ensureDirectory(home.binDir);
  yield* files.writeText(
    shim,
    `#!/bin/sh\nOMEN_HOME=${quote(home.root)} exec ${quote(process.execPath)} ${quote(cliEntry)} "$@"\n`,
  );
  yield* files.setMode(shim, 0o755);
});
