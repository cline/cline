# Kiro Runtime Deliverables Index

## Purpose

This index collects the key artifacts produced during the runtime-architecture refactor, Kiro CLI onboarding, test-environment design, harness implementation, and live verification work.

## Core Architecture

- [`runtime-architecture-review.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/kiro-cli-runtime-onboarding/runtime-architecture-review.md)
- [`current-runtime-paths.excalidraw`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/kiro-cli-runtime-onboarding/current-runtime-paths.excalidraw)

## Kiro Runtime Onboarding

- [`code-summary.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/kiro-cli-runtime-onboarding/code/code-summary.md)
- [`session-isolation-acceptance-spec.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/kiro-cli-runtime-onboarding/session-isolation-acceptance-spec.md)
- [`mac-linux-runtime-matrix-checklist.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/kiro-cli-runtime-onboarding/mac-linux-runtime-matrix-checklist.md)

## Planning Artifacts

- [`kiro-cli-runtime-test-environment-plan.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/plans/kiro-cli-runtime-test-environment-plan.md)
- [`kiro-cli-runtime-acceptance-harness-implementation-plan.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/plans/kiro-cli-runtime-acceptance-harness-implementation-plan.md)
- [`linux-aarch64-session-isolation-smoke-implementation-plan.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/plans/linux-aarch64-session-isolation-smoke-implementation-plan.md)

## Build And Test Artifacts

- [`unit-test-instructions.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/build-and-test/unit-test-instructions.md)
- [`integration-test-instructions.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/build-and-test/integration-test-instructions.md)
- [`build-and-test-summary.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/construction/build-and-test/build-and-test-summary.md)

## State And Audit

- [`aidlc-state.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/aidlc-state.md)
- [`audit.md`](/mnt/a2c_data/home/.cline/worktrees/a4561/cline/aidlc-docs/audit.md)

## Completion Note

This work should be treated as mergeable foundation work, not final completion.

The PR should explicitly state that:

- residual improvements are still required
- real integration testing must continue after merge
- the runtime layer is substantially improved, but not yet fully complete

## Residual Work To Call Out In The PR

- Kiro stdout normalization for ANSI prompt fragments
- broader real runtime matrix validation on macOS and Linux x86_64
- additional end-to-end integration tests through the control-plane flow
- continued reduction of provider-first seams in upper layers
