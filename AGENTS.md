# Omen

A minimal daemon that lets trusted people talk to agent Harnesses (Claude Agent SDK first) through Channels (Discord first), with everything beyond the core built as Plugins.

`CLAUDE.md` is a symlink to this file: edit `AGENTS.md`.

## Stack

Bun workspaces: `packages/sdk` (`@omen/sdk`, the only package plugins import), `packages/core` (`@omen/core`), `packages/cli` (`omen`, bin `src/main.ts`), and `plugins/{discord,claude,memory,scheduler,profiles}` (`@omen/plugin-<name>`). Packages reference each other with `workspace:*`, and each runtime dependency lives only in the package that uses it.

| Package                                         | Version    | Where                                                                              |
| ----------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| Bun (runtime, package manager)                  | 1.4.4      | `packageManager`, `engines`                                                        |
| `effect`                                        | 4.1.4      | every package                                                                      |
| `@effect/platform-bun`                          | 4.1.4      | core, cli                                                                          |
| `@effect/sql-sqlite-bun`                        | 4.1.4      | core                                                                               |
| `@effect/vitest`                                | 4.1.4      | core (dev)                                                                         |
| `drizzle-orm` (`drizzle-orm/effect-sqlite-bun`) | 1.0.0-rc.5 | core                                                                               |
| `@typeonce/effect-machine`                      | 0.46.0     | core                                                                               |
| `@anthropic-ai/claude-agent-sdk`                | 0.3.329    | plugins/claude                                                                     |
| `discord.js`                                    | 14.28.1    | plugins/discord                                                                    |
| `typescript`                                    | 7.0.2      | root (dev)                                                                         |
| `@effect/tsgo`                                  | 0.73.2     | root (dev); supports TS 7.0.2, oxlint 1.91–1.94, oxlint-tsgolint 7.0.2005–7.0.2007 |
| `oxlint`, `@oxlint/plugins`                     | 1.94.0     | root (dev)                                                                         |
| `oxlint-tsgolint`                               | 7.0.2007   | root (dev)                                                                         |
| `@typeonce/oxlint-plugin-effect-machine`        | 0.46.0     | root (dev)                                                                         |
| `oxfmt`                                         | 0.79.0     | root (dev)                                                                         |
| `knip`                                          | 6.46.1     | root (dev)                                                                         |
| `vitest`                                        | 5.1.1      | root (dev); `@effect/vitest` peers `>=5 <6`                                        |
| `@types/bun`                                    | 1.4.4      | root (dev); follows the Bun runtime                                                |
| `@types/node`                                   | 24.19.2    | root (dev); for `tools/oxlint`, whose tests run on Node 24                         |

Prerelease: `drizzle-orm` 1.0.0-rc.5, pinned exactly. No patched packages beyond the `effect-tsgo patch` that `prepare` applies to `typescript` and `oxlint`. The Claude Agent SDK's peers (`zod`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`) are installed automatically by Bun; declare `zod` in `plugins/claude` once its code imports it.

Deviations from the kickoff guides:

- **Tests run on two runtimes.** `bun run test` runs the `omen` Vitest project under Bun (`bun --bun vitest`) with `pool: "threads"`, because `bun:sqlite` exists only under Bun and Vitest's default `forks` pool crashes there (`child.channel.unref is not a function`). It then runs the `oxlint` project (the vendored lint-rule tests) under Node, because oxlint's `RuleTester` refuses non-Node runtimes. `packages/core/src/sqlite.test.ts` proves Drizzle over `@effect/sql-sqlite-bun` runs in tests.
- **No UI.** Skipped: StyleX, TanStack, React, Lingui, i18n, Playwright, the `react`, `jsx-a11y`, StyleX and Lingui lint rules, and ai-automation's React and UI-folder rules. Dropped from the TypeScript rules below: React, URL state, Copy and locales, Styling and design system, and the web layout tree. The "TypeScript stack" paragraph is rewritten for this stack.
- **No OpenTelemetry.** The spec says logs are structured JSON in `~/.omen/logs/omen.log` with no telemetry, so there is no OTLP exporter and the Observability rules below say so.
- **No backend, Alchemy or cloud**, so no `@alchemy.run/*`. The GitHub repository is private, so there are no workflows (release-please, CI, PR-title check).
- `@effect/language-service` is in the root Knip `ignoreDependencies`, since `@effect/tsgo` serves the tsconfig plugin under that name. `allowedUnstableApis` lists `@effect/vitest`, `@effect/platform-bun` and `@effect/sql-sqlite-bun`.
- Knip `ignoreDependencies` per package are temporary: the placeholders do not import their package's dependencies yet. Delete each entry once code imports that dependency.
- `docs/spec.md` is excluded from Oxfmt, so the spec keeps its authored table layout.
- `no-sql-type-parameter` is not enabled yet: enable it with the first SQL layer.

## Commands

`bun run verify` (format check, lint, typecheck, Knip, tests) must pass before any handoff. The other scripts are in `package.json`. Run `bun run dev:setup` once per checkout: it writes `.env.local` with this checkout's `OMEN_HOME` (`.omen-dev/`), and Bun loads `.env.local` automatically.

## Omen

- Read `docs/spec.md`, `GLOSSARY.md` and `docs/adr/` before changing behavior. Name code, logs and docs with the glossary's terms, and avoid the synonyms it lists under _Avoid_.
- Every state path comes from `OMEN_HOME`, never a hardcoded `~/.omen`.

## Definition of done

- Work is done when the `verify` command passes. It covers format, lint, typecheck, dead-code detection, and tests. Run it before every handoff, and paste failures rather than summarizing them.
- When a check fails, fix the code. Do not loosen config, lower severities, or add ignores to make a check pass.
- Suppress a rule only at a genuine boundary, such as untyped third-party code, FFI, or a framework-required shape. Write the suppression on the line itself, scoped to the one rule, with a `SAFETY:` comment explaining why the code is sound.
- If you notice a mistake that could recur, encode the fix as a type, lint rule, or test. Add a prose rule only when the fix can't be automated.

## Types and domain modeling

- Run the compiler and linter in their strictest modes. Avoid `any` and other dynamic escape hatches, unchecked casts, and force-unwraps.
- Parse untrusted input at the boundary: HTTP, storage, URL, environment, files, user input. Turn it into typed domain values there. Core code accepts only parsed values and never re-validates.
- Brand every primitive that carries meaning: IDs, emails, money, slugs, timestamps. A `UserId` cannot be passed where a `PostId` is expected.
- Model alternatives as tagged unions or enums and handle them with exhaustive matching. Make illegal states unrepresentable. For example, `Loading | Loaded(data) | Failed(error)` replaces `isLoading` plus `data?` plus `error?`.
- Errors are typed values that appear in signatures. Expected failures, such as not found or invalid input, are typed errors the caller handles. Bugs and broken invariants are defects that crash, and they get logged once at the outer boundary.

## State and side effects

- Model behavior that changes over time as an explicit statechart: finite states that nest, events named after domain actions, and transitions that are synchronous and deterministic. States that share data or transitions sit under one parent state, which owns them once. Async work belongs to the state that needs it. The work starts when the machine enters that state and is cancelled when it leaves.
- Global mutable state and stateful singletons are not allowed. Inject dependencies through services, layers, protocols, or traits.
- Put I/O, time, randomness, and storage behind injected capabilities, so tests can substitute deterministic fakes.
- Split UI state by whether a reload or a shared link should restore it. The URL holds page state: which page and resource, plus the filters, sort, pagination, and tab that shape it. A state machine holds interaction state: open sheets, dialogs, menus, pickers, drafts, and wizard progress. A view worth linking to, such as one entry's details, gets its own route, not a flag on another page.
- Every checkout runs in isolation, so worktrees can run side by side. Ports, local URLs, databases, state paths, simulators, and dev app IDs come from the checkout's gitignored local config, created by `dev:setup`. Never hardcode them. Dev servers pick free ports at start and print their URLs.

## Observability

- Logs are structured JSON written to `$OMEN_HOME/logs/omen.log`. There is no telemetry and no exporter.
- Log with `Effect.log*` and annotate with the IDs that identify the operation. Never put secrets or personal data in logs.
- Configure the logger only at the entry point. Tests write no log files.

## Structure

- Organize by feature: `features/<feature>/{domain,services,machines,components}`. Code that is shared and generic goes in a top-level `ui/` or `shared/`. A feature uses another feature only through that feature's service contract.
- Put one concept in each file and give it a specific name. Files named `utils`, `helpers`, or `misc` are not allowed.
- Write files that read in one pass. Aim for under 200 lines, and split any file that grows past 300 along a real seam. A state machine's states, events, and transitions are one seam and stay together. Move pure data steps to the domain, and give sub-flows their own machine.
- Every module is owned by the feature that uses it. Extend the existing owner before creating a new file, service, or abstraction.

## Tests

- Test behavior through public interfaces: given these inputs or events, expect these outputs, states, or errors. A test should survive any refactor that keeps the behavior.
- Swap dependencies through injection (test layers, fakes). Module mocking is not allowed, and tests must not assert on internal calls.
- Start every bug fix with a test that fails on the bug. When existing tests specify the buggy behavior, rewrite them to the correct behavior first and watch them fail.
- Tests are deterministic. They do not depend on wall-clock time, network, execution order, or shared state.

## Stack changes

- This project was kicked off with the `kickoff` skill. Before adding a capability its setup guides cover, such as a backend, infrastructure, a SQL store, or a UI, follow the skill's `extend.md`. If the skill is not installed, clone it with `gh repo clone szymonograbek/skills` into a temporary directory and read `skills/kickoff/extend.md`.

## Dependencies

- Use current releases. Prerelease versions (alpha, beta, rc) are acceptable when they work. Pin them exactly and list them under `## Stack`.
- Check the registry and the library's own docs or source before using an API. Do not rely on memory.

## Commits and releases

- Every commit message follows Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `perf:`. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.

## TypeScript stack

The core is Effect v4 on Bun. Stateful flows use `@typeonce/effect-machine`. SQL is sqlite through Drizzle's `drizzle-orm/effect-sqlite-bun` over `@effect/sql-sqlite-bun`. Tooling is TypeScript 7 with `@effect/tsgo`, Oxlint, Oxfmt, Knip, and Vitest with `@effect/vitest`.

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->

## Local Effect Source

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference, checked out at the tag of the installed `effect` version.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

## Effect

- Business logic lives in `Context.Service` classes. Each one carries a `static readonly layer`, plus a `testLayer` where tests need one. Define methods with `Effect.fn("Service.method")`. Method signatures have no requirements (`R = never`). Dependencies are yielded inside the layer.
- Provide layers once, at an entry point: the server main, the CLI main, or the atom runtime. Store any parameterized layer in a module-level constant so it is memoized.
- Model data with `Schema.Class`, `Schema.TaggedClass`, and `Schema.Union`. Brand primitives with `Schema.brand`. Decode unknown input with Schema at the boundary.
- Define errors with `Schema.TaggedError`. Recover with `catchTag` or `catchTags`. Wrap foreign errors in a `Schema.Defect()` field. Use `orDie` only for failures nothing can recover from.
- Prefer Effect primitives to platform globals:
  - `Clock` or `DateTime` over `Date`
  - `Random` over `Math.random`
  - `HttpClient` over `fetch`
  - Schema JSON over `JSON.*`
  - `Effect.sleep` or `Schedule` over timers
  - `Match` over `switch`
  - `Option` over `null` checks
  - `Ref` or `SubscriptionRef` over mutable variables
  - `Config` over `process.env`
- SQL goes through Drizzle's Effect driver (`drizzle-orm/effect-*`, or `@alchemy.run/drizzle` inside an Alchemy runtime) and one `Database` service. No raw SQL clients and no other ORM. With a domain model, SQL is only a store behind a projection's port, implemented in the server package.
- Spans come from `Effect.fn` names. Add `Effect.withSpan` for meaningful steps inside a method, and `Effect.annotateCurrentSpan` for domain IDs. Log with `Effect.log*` and annotate logs with `Effect.annotateLogs`, never `console`.
- Application code has no `async`/`await`, `new Promise`, or `try`/`catch`. Wrap a foreign Promise API once, inside the service that owns it, with `Effect.tryPromise`.
- Generate seed and fixture data with `Arbitrary.schema` from `effect`, derived from the domain schemas, and sample it with `Arbitrary.sampleEffect` and a fixed `seed`. Where a field must look real (names, emails, addresses), `Arbitrary.map` a generated integer to a `Faker` instance from `@faker-js/faker` seeded with it, so output stays reproducible. Install `@faker-js/faker` as a dev dependency with the first seed. `Arbitrary` is unstable: add it to `allowedUnstableApis` if `@effect/tsgo` reports it. Docs: https://effect.website/docs/v4/schema/arbitrary
- Effect 4.0 stable exports modules such as `effect/http`, `effect/cli`, and `effect/reactivity`. Guides and beta-era code may use other names or `effect/unstable/...` paths. When they disagree with the installed package, the typechecker decides.

## State machines

Use `@typeonce/effect-machine` for any flow with more than one mode, such as load/edit/submit/fail, wizards, auth, or connections. Model each one as a statechart. Read `node_modules/@typeonce/effect-machine/docs/agent-guide.md` before writing a machine, and `effect-atom-react.md` before wiring one into React.

- A flat list of sibling states is the default to push past. Its signs: the same transition (`Cancel`, `Close`, `SignOut`) repeated on several states, the same field copied into several states' data, or a state name that joins two modes (`EditingWhileSaving`). Each sign means a missing parent state.
- Represent modes as states, never as boolean flags. Group states that share data or transitions under a compound parent: `Open { Viewing, Editing, Saving }` owns `document` and `Close` once, instead of three siblings each carrying both. Put data on the lowest state that owns it, and put shared transitions on the lowest common ancestor.
- Use a parallel state only for modes that change independently, such as a connection status beside an editor. Use a history state to return to where the user was, such as resuming a wizard step after a dialog. Use a timer invocation for timeouts and delays.
- Name events after domain actions and outcomes (`Submit`, `Cancel`, `Loaded`), never as setters (`SetLoading`). Event payloads carry only facts the machine cannot already read from its own state.
- Transitions are synchronous and deterministic. They never read the clock or randomness and never call services. Register async work under `effects` in `make`, and run it through `invoke` on the state that owns it.
- Per-owner capabilities, such as navigation or a router, are Effect services provided through the owner's layer. They never go in state data or input, because snapshots must stay encodable.
- Test machines with `MachineTest`: run event traces, then assert on reached states and invariants.

## Layout

- Do not create barrel files or modules that only re-export. Import from the module that owns the code.
- Put each test beside its module as `*.test.ts`.
- When Knip reports unused files, exports, or dependencies, delete them. Ignore an entry only if a framework loads it in a way Knip cannot see.
