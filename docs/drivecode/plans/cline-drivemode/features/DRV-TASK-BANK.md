# DRV-TASK-BANK · Task bank and Drive loop

Back to [README](../README.md). Spans phase 1 (posture) and phase 2 (now/next) in [TASK-GRAPH](../TASK-GRAPH.md). Product: [PRD 9](../prd/prd-task-bank-drive-loop.md). Decision: [ARD-0008](../ard/ARD-0008-task-bank.md).

## Problem / user value

Drive needs a steady bank of work. Tasks are durable and implementable. Plans are editable indexes of task refs. Posture becomes Plan or Agent from bank state so the user stops switching modes for routine multi-step work.

## Acceptance criteria

- Workspace layout `.drive/bank/{tasks,plans,archive/tasks,archive/plans}` is documented and enforced by the store.
- `DriveTask` and `DrivePlan` schemas parse at the `@cline/shared` boundary; illegal shapes fail parse.
- Bank store (injected `BankFs`) can create plans/tasks, complete→archive tasks, drain→archive plans, and edit plan refs without mutating archived tasks.
- `BankSnapshot` exposes `activePlanId`, `openTaskIds`, `nowTaskId`, `nextTaskId`.
- While Drive is on and no Ask/Debug override: empty/uncovered → Plan; open task → Agent bound to `nowTaskId`.
- Unbound Agent workspace mutations are refused (policy).
- Ask/Debug overrides clear only via explicit clear.
- Work-track events cover task/plan lifecycle with version fields (DRV-EVENTS).
- Now/next derives from `BankSnapshot` and collapses when no active plan (DRV-NOWNEXT).
- No `Team*` identifiers in bank code; no Focus Chain dependency.

## Dependencies

- DRV-EVENTS (event union), DRV-KERNEL (`@cline/drive`), DRV-HOOK-POLICY (Ask/Debug enforcement), DRV-MODE-OVERLAY (posture surface), DRV-NOWNEXT (cursor UI).

## Surfaces touched

- `sdk/packages/shared/src/drive/` (bank + events)
- `sdk/packages/drive/src/` (paths, snapshot, store, loop policy, driveMode)
- `apps/cline-hub/src/webview/src/drive/` (NowNext, plan editor, posture wire)
- Docs amendments listed in PRD 9

## Agent tasks

- [ ] Land PRD 9, ARD-0008, this feature file, and cross-links.
  - Owner package: repo docs
  - Verify: cross-links resolve from prd/ard/README and TASK-GRAPH
  - Done when: PRD 9 and ARD-0008 are indexed.
- [ ] Add `DriveTask` / `DrivePlan` schemas and bank lifecycle events in `@cline/shared`.
  - Owner package: `@cline/shared`
  - Verify: `bun -F @cline/shared test`
  - Done when: parse and privacy tests pass; `bun run build:sdk` succeeds.
- [ ] Implement bank paths, snapshot, injected-fs store, and archive moves in `@cline/drive`.
  - Owner package: `@cline/drive`
  - Verify: `bun -F @cline/drive test`
  - Done when: create/complete/archive/edit-plan tests pass.
- [ ] Implement loop policy (auto Plan/Agent, overrides, unbound refuse).
  - Owner package: `@cline/drive`
  - Verify: `bun -F @cline/drive test`
  - Done when: policy matrix tests pass.
- [ ] Wire NowNext + minimal plan editor + posture pill to bank snapshot in hub webview.
  - Owner package: `@cline/cline-hub`
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: fixtures render now/next and derived posture; Ask override blocks edit intent in UI state.

## Risks

- Kernel vs persistence boundary. Mitigation. Injected `BankFs`; no `node:fs` import inside `@cline/drive`.
- Naming collisions with Team/Focus Chain. Mitigation. `DriveTask` / `DrivePlan` only; CI `/Team|team_/` guard when DRV-ROSTER-PACK lands.
