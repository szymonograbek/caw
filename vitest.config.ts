import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "caw",
          include: ["{packages,plugins}/*/src/**/*.test.ts"],
          // Runs under Bun (`bun --bun vitest`) so `bun:sqlite` exists; the default forks pool crashes on Bun.
          pool: "threads",
        },
      },
      "tools/oxlint",
    ],
  },
});
