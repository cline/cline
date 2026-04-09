# Testing Plan

This file tracks the test strategy and implementation progress for `@clinebot/cli`, `@clinebot/core`, and `@clinebot/llms`.

## Goals

- Deterministic tests: no real network/OAuth, isolated filesystem/env per test.
- Contract-focused coverage: exit codes, output shape, persisted artifacts, runtime/session behavior.
- Clear layering: unit tests for logic seams, e2e tests for real process/runtime integration.
- Explicit live smoke layer: opt-in real-provider checks that validate external integration wiring without making default test runs flaky.

## Live Provider Testing Philosophy (`@clinebot/llms`)

- Purpose: catch provider integration drift (auth, endpoint, model routing, stream completion semantics) against real configured providers.
- Scope: one small prompt per configured provider; this is a health/smoke pass, not a quality benchmark.
- Opt-in by design: live provider tests must stay disabled in default unit/e2e runs.
- Failure model: collect and report all failing providers in one run so triage is fast.
- Stability guardrails:
  - per-provider timeout
  - no requirement in normal CI gating unless explicitly enabled by environment
  - keep deterministic tests as the primary reliability signal

## Phased Plan

1. Core e2e scaffolding and first lifecycle e2e test
- Add dedicated e2e Vitest config for `packages/core`.
- Add `test:unit` and `test:e2e` scripts to `packages/core/package.json`.
- Add first core e2e test that validates a local session lifecycle roundtrip.
- Status: `completed`

2. CLI e2e contract and failure-path expansion
- Add e2e cases for invalid subcommands/flags, JSON mode constraints, piped input merge paths, sandbox wiring, and approval behavior in non-TTY mode.
- Status: `in_progress`

3. CLI unit seam extraction and focused unit tests
- Refactor `apps/cli/src/index.ts` to expose small pure helpers for command resolution/config/policy assembly.
- Add unit tests for those helpers and keep existing e2e tests for end-to-end validation.
- Status: `pending`

4. Core package export/entrypoint contract tests
- Add tests that verify all `exports` entrypoints in `packages/core/package.json` load expected symbols.
- Status: `pending`

## Current Validation Snapshot

- `bun -F @clinebot/core test:e2e`: passing.
- `bun -F @clinebot/core test:unit`: fails due to pre-existing failures in:
  - `src/storage/provider-settings-legacy-migration.test.ts`
  - `src/input/mention-enricher.test.ts`
  - `src/input/file-indexer.test.ts`

## Execution Notes

- Run core unit tests: `bun -F @clinebot/core test:unit`
- Run core e2e tests: `bun -F @clinebot/core test:e2e`
- Run core full tests: `bun -F @clinebot/core test`
- Run llms live provider smoke test:
  - `cd sdk-wip/packages/llms`
  - `LLMS_LIVE_TESTS=1 LLMS_LIVE_PROVIDERS_PATH=/absolute/path/to/providers.json bun test src/live-providers.test.ts`
  - Optional timeout override: `LLMS_LIVE_PROVIDER_TIMEOUT_MS=120000`

## CLI e2e Flow and Coverage

The CLI e2e suite lives in `apps/cli/src/cli.e2e.test.ts` and runs with `apps/cli/vitest.e2e.config.ts`.

Execution flow for each e2e test:

1. Build an isolated runtime environment:
   - Create temp directories for `HOME`, `CLINE_DATA_DIR`, `CLINE_SESSION_DATA_DIR`, and `CLINE_TEAM_DATA_DIR`.
   - Set provider settings and hooks log paths to temp locations.
2. Spawn a real CLI process:
   - Use `spawnSync` to execute `bun apps/cli/src/index.ts ...args`.
   - Pass args/stdin/cwd/env exactly like a real user invocation.
3. Assert CLI contracts:
   - Exit code (`status`)
   - stdout/stderr content or JSON shape
   - filesystem side effects (for example persisted hook logs or listing data from isolated paths)
4. Cleanup:
   - Remove all temp directories in `afterEach` so tests stay deterministic.

What is covered today in CLI e2e:

- Basic process contracts:
  - `--help`, `--version`
  - invalid output mode (`--output xml`)
  - invalid mode (`--mode build`)
  - invalid `--session` usage
- JSON mode constraints:
  - `--json` requires prompt or piped stdin
  - `--json --interactive` is rejected
- Command validation paths:
  - unknown `list` target
  - unknown `rpc` subcommand
  - missing provider in `auth`
  - `sessions delete` requires `--session-id`
- Storage/listing behavior with isolated data:
  - `sessions list`
  - `list history`
  - `list workflows` (text/json, disabled filtering, workspace root discovery from subdirectory, Documents/Cline path inclusion)
  - `list rules` and `list skills` (including Documents/Cline path inclusion)
  - `list agents` (text/json, source path visibility)
  - `list mcp` (text/json, disabled marker)
- Hook command behavior:
  - invalid payload rejection
  - valid payload acceptance and audit log write

## What to Test: e2e vs Unit

Use e2e tests when the contract depends on real process wiring:

- CLI argument parsing + command dispatch as a whole process.
- Exit codes and user-facing stdout/stderr formatting.
- Interaction between CLI and environment variables/filesystem paths.
- Multi-module integration (CLI entrypoint + command modules + core/rpc glue).
- Real invocation semantics (`cwd`, piped stdin, non-TTY behavior).

Use unit tests when validating local logic with fast, deterministic inputs:

- Pure helpers (arg normalization, policy merge logic, formatting, parsing helpers).
- Branch-heavy command helpers where process spawn is unnecessary.
- Error mapping/translation logic (input -> expected message/code path).
- Small behavior seams with mocked dependencies (for example provider settings or RPC client wrappers).

Rule of thumb:

- If the requirement is "what a user sees when running `clite ...`", prefer e2e.
- If the requirement is "a function transforms input X into output Y", prefer unit.
- Keep one e2e assertion per end-user contract, and push combinatorial edge cases into unit tests.
