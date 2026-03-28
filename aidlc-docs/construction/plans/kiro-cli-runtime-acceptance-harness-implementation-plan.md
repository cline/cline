# Implementation Plan - kiro-cli-runtime-acceptance-harness

## Goal

Implement a runtime acceptance harness that validates Kiro CLI under the same class of conditions that matter for Cline as an isolated terminal-session control plane.

## Plan Status

- [x] Step 1. Add a dedicated acceptance-harness directory outside the current direct Mocha path
- [x] Step 2. Define harness inputs for runtime path, prompt set, working directory, timeout, env markers, and output capture
- [x] Step 3. Implement a real-subprocess runner that launches `kiro-cli chat --no-interactive` through the same shim-facing contract assumptions
- [x] Step 4. Add result normalization for success, timeout, cancel, and process-failure outcomes
- [x] Step 5. Add fixture helpers for isolated `cwd`, `TMPDIR`, transcript files, and env tagging
- [x] Step 6. Add a minimal prompt suite for bounded acceptance checks with short deterministic prompts
- [x] Step 7. Add a CLI entrypoint or script command for single-session runtime acceptance execution
- [x] Step 8. Document required operator setup, including authenticated Kiro CLI and platform prerequisites
- [x] Step 9. Add a code summary or runbook artifact under `aidlc-docs/construction/kiro-cli-runtime-onboarding/`

## Scope

- real Kiro subprocess execution
- bounded acceptance prompts
- success and failure normalization
- environment and working-directory isolation preparation

## Out of Scope

- structured tool-call parity
- benchmark-grade latency measurement
- generalized multi-runtime harness abstraction beyond Kiro MVP needs

## Proposed Write Targets

- `src/integrations/kiro-cli/` or adjacent runtime-test support surface if reuse is appropriate
- `scripts/` or another repo-standard executable location for operator-triggered acceptance commands
- `aidlc-docs/construction/kiro-cli-runtime-onboarding/` for operator documentation

## Verification Target

- operator can run one command in an authenticated environment and observe a normalized pass/fail result for:
  - command discovery
  - non-interactive text response
  - timeout handling
  - process failure handling
