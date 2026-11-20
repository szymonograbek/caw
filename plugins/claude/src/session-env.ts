/**
 * The environment Claude Code runs a Session in. `CLAUDE_CODE_ENTRYPOINT`
 * names Caw as the caller: without it, Claude Code under the Agent SDK takes
 * a code path that uses about twice the tokens. It overrides any inherited
 * value, e.g. when the daemon was started from a Claude Code shell.
 */
export const sessionEnv = (env: Readonly<Record<string, string>>) => ({
  ...env,
  CLAUDE_CODE_ENTRYPOINT: "caw",
});
