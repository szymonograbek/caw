import * as NodePath from "node:path";
import { Effect } from "effect";
import { HostFiles } from "./host-files.ts";
import { OmenHome } from "./omen-home.ts";

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const skillManifest = `{
  "name": "omen",
  "version": "0.0.0",
  "description": "How to control Omen, the daemon this agent runs in"
}
`;

const skill = `---
name: omen
description: Controls Omen, the daemon you run inside. Use when asked to schedule something, remember or forget something, change the Harness profile or reply mode, or manage plugins.
---

You run inside Omen. Run \`omen guide\` to learn how to control it: schedules, memory, profiles, plugins, conversation settings. \`omen guide <topic>\` explains one topic.
`;

/**
 * Writes what a Session's agent uses from `OMEN_HOME`: the `omen` shim on its
 * `PATH` (running `cli`, the command that starts this CLI, against this home)
 * and Omen's core skill. Both live on disk because a compiled `omen` binary
 * keeps its own files where the agent's processes cannot read them.
 */
export const writeAgentFiles = Effect.fn("writeAgentFiles")(function* (cli: ReadonlyArray<string>) {
  const home = yield* OmenHome;
  const files = yield* HostFiles;
  const shim = NodePath.join(home.binDir, "omen");
  const skillFile = NodePath.join(home.skillDir, "skills", "omen", "SKILL.md");
  const manifest = NodePath.join(home.skillDir, ".claude-plugin", "plugin.json");

  yield* files.ensureDirectory(home.binDir);
  yield* files.writeText(
    shim,
    `#!/bin/sh\nOMEN_HOME=${quote(home.root)} exec ${cli.map(quote).join(" ")} "$@"\n`,
  );
  yield* files.setMode(shim, 0o755);

  yield* files.ensureDirectory(NodePath.dirname(skillFile));
  yield* files.writeText(skillFile, skill);
  yield* files.ensureDirectory(NodePath.dirname(manifest));
  yield* files.writeText(manifest, skillManifest);
});
