const dotEnvLine = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*?)\s*$/;

const keyOf = (line: string): string | undefined =>
  line.trimStart().startsWith("#") ? undefined : dotEnvLine.exec(line)?.[1];

/** `KEY=value` lines; `#` comments and blank lines are skipped, one pair of quotes is stripped. */
export const parseDotEnv = (contents: string): Record<string, string> =>
  Object.fromEntries(
    contents.split(/\r?\n/).flatMap((line) => {
      const key = keyOf(line);
      const raw = dotEnvLine.exec(line)?.[2];

      if (key === undefined || raw === undefined) {
        return [];
      }

      return [[key, raw.replace(/^(['"])(.*)\1$/, "$2")] as const];
    }),
  );

/** Quoted when it holds spaces or `#`; `parseDotEnv` strips one pair of quotes. */
const formatValue = (value: string): string => (/[\s#]/.test(value) ? `"${value}"` : value);

/**
 * `contents` with each of `entries` set: an existing line for the key is
 * replaced in place, a new key is appended. Other lines are kept as written.
 */
export const updateDotEnv = (
  contents: string,
  entries: Readonly<Record<string, string>>,
): string => {
  const lines = contents.length === 0 ? [] : contents.replace(/\r?\n$/, "").split(/\r?\n/);
  const pending = new Map(Object.entries(entries));

  const kept = lines.map((line) => {
    const key = keyOf(line);
    const value = key === undefined ? undefined : pending.get(key);

    if (key === undefined || value === undefined) {
      return line;
    }

    pending.delete(key);

    return `${key}=${formatValue(value)}`;
  });

  const added = [...pending].map(([key, value]) => `${key}=${formatValue(value)}`);

  return `${[...kept, ...added].join("\n")}\n`;
};
