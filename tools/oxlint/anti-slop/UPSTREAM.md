# anti-slop (vendored)

- Source: https://github.com/dmmulroy/anti-slop
- Commit: `13909c9e07590f5a85d93c62712259fe14a883f7`
- Copied: upstream `src/` to `tools/oxlint/anti-slop/`, rule tests included. The nested `vendor/eslint-stylistic/` keeps its own `LICENSE` and `UPSTREAM.md`.

## Deviations

- None in the source. `require-readable-spacing-cli.test.ts` is excluded from Vitest, because it shells out to `pnpm`.
