# Task-bank Drive loop · overview

Back to [../README.md](../README.md). Product: [PRD 9](../prd/prd-task-bank-drive-loop.md). Decision: [ARD-0008](../ard/ARD-0008-task-bank.md). Feature: [DRV-TASK-BANK](../features/DRV-TASK-BANK.md).

## Context

Drive needs a durable task bank. Plans are ordered refs. Posture derives from bank state.

## Scope

Included: docs, shared schemas, `@cline/drive` bank + loop, hub NowNext / plan editor / posture wire.

Excluded: Focus Chain bridge, `team_task`, fuzzy matching, CLI parity, media.

## Phases

1. [phase-1-domain-docs.md](phase-1-domain-docs.md)
2. [phase-2-shared-types.md](phase-2-shared-types.md)
3. [phase-3-bank-store.md](phase-3-bank-store.md)
4. [phase-4-loop-policy.md](phase-4-loop-policy.md)
5. [phase-5-events-cursor.md](phase-5-events-cursor.md)
6. [phase-6-archive-lifecycle.md](phase-6-archive-lifecycle.md)
7. [phase-7-plan-editor-ux.md](phase-7-plan-editor-ux.md)
8. [phase-8-mode-overlay-wire.md](phase-8-mode-overlay-wire.md)

Verification: [testing.md](testing.md).

## Implementation status

Reconciled against `main`: phases 1 (domain docs), 3 (bank store), 6
(archive lifecycle), and 7 (plan editor UX) are evidenced complete. Phases 2
(shared lifecycle-event tests), 4 (mutation-policy enforcement), 5 (complete
event/cursor wiring), and 8 (native mode-overlay wiring and durable Hub bank
ownership) are partial.

The Hub still seeds an in-memory demo bank. Remaining work must close the
lifecycle-event test matrix, enforce loop policy at the mutation boundary,
emit and consume the complete bank lifecycle, replace demo seeding with the
Hub writer, and wire the canonical mode pill.

## Implementation guidance

- Run **how** before hub turn-loop changes.
- **interrogate** ARD-0008 if layout is contested.
- `/deslop` before commit; **unslop** on prose.
- **control-ui** for hub smoke; **babysit** after PRs.
