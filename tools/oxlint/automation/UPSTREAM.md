# automation (vendored from ai-automation)

- Source: https://github.com/typeonce-dev/ai-automation, `rules/oxlint/`
- Commit: `0bca096fe6fe9878cd15303a623dd2cd85915ddd`
- Copied unchanged into `rules/`: `no-ambient-nondeterminism`, `no-banned-type-assertions`, `no-cascading-layer-provide`, `no-direct-browser-storage`, `no-direct-fetch`, `no-disable-validation`, `no-effect-asvoid`, `no-global-json`, `no-in-operator`, `no-nested-effect-array-methods`, `no-nested-layer-provide`, `no-optional-function-parameters`, `no-reexport-only-modules`, `no-service-option`, `no-shadowed-standard-array-static`, `no-silent-error-swallow`, `no-static-effect-service-forwarders`, `no-switch`, `no-try-catch`, `no-type-assertion`, `no-typeof-object`, `pipe-max-arguments`, `prefer-option-from-nullable`, `require-context-service-in-services`.
- `rules.test.ts` holds upstream's `test/rules.test.ts` cases for exactly those rules.

## Deviations

- `index.ts` registers only the copied rules, without upstream's `profiles.ts` and catalog re-exports.
- Not vendored: the React rules (`no-react-state-hooks`, `no-react-component-inner-functions`, `no-react-non-component-function-exports`, `require-tsx-in-ui-folders`), because Omen has no UI; `no-sql-type-parameter`, until the SQL layer exists; and the style, xstate, tailwind and HTTP-layout rules the kickoff guide skips.
- Project-owned: `rules/no-nested-yield.ts` has no upstream. It bans `yield*` inside the operand of another `yield*`.
