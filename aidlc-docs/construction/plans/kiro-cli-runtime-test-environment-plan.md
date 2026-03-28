# Kiro CLI Runtime Test Environment Plan

## Goal

Design a production-relevant test environment for the Kiro CLI runtime assuming Cline acts as an isolated terminal-session control plane rather than the runtime itself.

## Scope

- Kiro CLI runtime onboarding validation
- session isolation validation
- macOS and Linux execution compatibility
- separation of runtime acceptance from Node 25 plus Mocha test-runner constraints

## Design Principles

- Test the runtime boundary, not the model quality.
- Treat Cline as a control-plane channel that launches isolated subprocess sessions.
- Separate TypeScript unit-test concerns from real runtime acceptance concerns.
- Use real `kiro-cli` subprocess execution for acceptance gates.
- Keep per-session `cwd`, env, temp files, transcript, and config isolated.

## Test Layers

### Layer 1. Contract and Unit Validation

- Purpose: validate runtime registry, persistence boundary, shim wrapper, handler factory, prompt builder, and proto conversion.
- Runtime dependency: none or mocked process execution.
- Environment:
  - Node LTS baseline recommended
  - local alias-aware test runner or current targeted smoke commands
- Exit criteria:
  - `kiro-prompt-ok`
  - `kiro-factory-ok`
  - `kiro-runtime-modules-ok`
  - `kiro-proto-ok`

### Layer 2. Real Runtime Integration

- Purpose: validate that Cline can launch the real `kiro-cli` binary through the runtime shim.
- Runtime dependency: installed and authenticated `kiro-cli`
- Environment:
  - isolated shell session
  - dedicated working directory
  - dedicated temp directory
  - explicit `PATH`
- Exit criteria:
  - `kiro-cli chat --no-interactive` returns text successfully
  - non-zero exit handling is normalized
  - timeout and cancellation are observable

### Layer 3. Session Isolation Acceptance

- Purpose: validate the core product value that each runtime executes in an isolated session boundary.
- Runtime dependency: real `kiro-cli`
- Environment:
  - parallel sessions with distinct env and workdir
  - separate transcript capture
  - separate config view where feasible
- Exit criteria:
  - no cross-session leakage of cwd, env, transcript, or result stream

### Layer 4. Platform Compatibility Matrix

- Purpose: validate installation and execution assumptions on supported operating systems.
- Runtime dependency: real `kiro-cli`
- Environment:
  - macOS arm64
  - Linux x86_64 glibc 2.34+
  - Linux aarch64 glibc 2.34+
  - optional musl validation for older Linux distributions
- Exit criteria:
  - install succeeds
  - authentication succeeds
  - non-interactive chat succeeds

## Environment Strategy

### Baseline

- Unit and contract tests must not be blocked by Node 25 plus Mocha ESM path-alias issues.
- Runtime acceptance must be evaluated separately from the current Mocha harness.
- Node LTS should be the reference environment for repeatable TypeScript test execution.

### Runtime Harness Requirements

- fixed `kiro-cli` path or explicit discovery check
- authenticated runtime account prepared before test start
- deterministic shell environment
- deterministic working directory fixture
- deterministic temp directory fixture
- bounded prompt set with short responses

### Session Fixture Requirements

- unique session identifier
- unique workdir
- unique `TMPDIR`
- unique output capture file
- unique env marker such as `CLINE_RUNTIME_SESSION_ID`
- optional unique `HOME` or Kiro settings root if the CLI supports it safely

## Recommended Execution Order

1. Run Layer 1 contract checks.
2. Run Layer 2 real runtime integration on one platform.
3. Run Layer 3 session isolation on the same platform.
4. Expand to Layer 4 macOS and Linux matrix.
5. Promote the Kiro runtime path from MVP to production-ready only after Layers 2 through 4 pass.

## Risks

- Kiro CLI currently exposes a text-first non-interactive path, not Claude-style structured tool streaming.
- Authentication may require browser-based setup outside CI.
- Session-level config isolation may be limited by Kiro CLI configuration semantics.
- Node 25 plus Mocha issues can create false negatives in unit tests if treated as runtime failures.

## Recommended Next Actions

- Add a dedicated runtime acceptance harness outside direct Mocha execution.
- Add session isolation smoke scripts for dual-session parallel execution.
- Add macOS and Linux checklist-driven runbooks for operator verification.
