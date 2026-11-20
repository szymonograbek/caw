const localCommands = new Set(["start", "stop", "status", "install", "logs", "guide"]);

/**
 * Whether the CLI runs `argv` itself. Everything else, including `plugin`
 * commands other than `add`, runs in the daemon.
 */
export const runsLocally = (argv: ReadonlyArray<string>): boolean => {
  const [first, second] = argv;

  return (
    first === undefined ||
    first.startsWith("-") ||
    localCommands.has(first) ||
    (first === "plugin" && second === "add")
  );
};
