import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Runs under Node: oxlint's RuleTester refuses other runtimes.
    name: "oxlint",
    // RuleTester registers its cases only when describe/it are globals.
    globals: true,
    include: ["**/*.test.ts"],
    // Shells out to pnpm, which this repository does not use.
    exclude: ["**/require-readable-spacing-cli.test.ts"],
  },
})
