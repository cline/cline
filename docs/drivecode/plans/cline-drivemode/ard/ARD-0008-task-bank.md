# ARD-0008: Task bank is Drive’s execution primitive

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 9, DRV-TASK-BANK, DRV-MODE-OVERLAY, DRV-NOWNEXT, DRV-EVENTS

## Context

Drive postures are user-picked today. Plans in Cline are chat prose. Cursor-drive embeds todos inside plan files and archives whole plans. Cline already claims Focus Chain checklists and `TeamTask`. None of those give Drive a durable, editable-sequencer / immutable-work-unit split.

## Decision

1. **Drive owns a workspace bank** at `.drive/bank/` with `tasks/`, `plans/`, `archive/tasks/`, and `archive/plans/`.
2. **`DriveTask` is the implementable unit.** Detail lives in the task file. Completed tasks move to archive (read-only in MVP).
3. **`DrivePlan` is an ordered list of task ids.** Plans are ephemeral and editable. Drained or closed plans archive. Plan edits never rewrite archived task files.
4. **One active plan per room.** Other plans may exist as drafts.
5. **Posture derives from bank state** while Drive is on: empty or no open tasks → Plan; open tasks → Agent bound to now task. Ask and Debug are explicit user overrides cleared only by explicit clear.
6. **Covered-check is strict.** An Agent turn must bind a `taskId`. Unbound Agent mutation tools are refused into Plan at the policy layer. No fuzzy matching.
7. **Partial failure leaves the task open** with `lastFailure`. The partner may propose a sibling fix-up task.
8. **Non-bridges for MVP.** Do not reuse or sync Focus Chain or `team_task`. No `Team*` identifiers under Drive bank code.
9. **Persistence is not inside the pure kernel.** `@cline/drive` exposes pure path helpers, snapshot derivation, loop policy, and a bank store over an injected `BankFs`. Hub/core supplies the filesystem adapter and remains the single writer.
10. **Override clear is explicit only.** Setting Ask/Debug does not auto-clear on the next bank-driven turn.

## Consequences

**Positive**

- Continuous work bank; posture auto-selection removes routine mode switching.
- Completed work survives plan rewrites.
- Now/next has a typed source (`BankSnapshot`).

**Negative**

- New on-disk layout and event family to maintain.
- Strict covered-check can feel rigid for one-shot work (mitigation: Ask override).

## Alternatives considered

- **Port cursor-drive `.cursor/plans`.** Rejected. Embedded todos invert the desired immutability split.
- **Reuse `team_task`.** Rejected. `Team` is banned in Drive identifiers; different lifecycle.
- **Focus Chain as sole cursor.** Rejected. Extension-local; no shared archive semantics.

## References

- [PRD 9](../prd/prd-task-bank-drive-loop.md)
- [DRV-TASK-BANK](../features/DRV-TASK-BANK.md)
- [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md)
- [DRV-NOWNEXT](../features/DRV-NOWNEXT.md)
- [DRV-EVENTS](../features/DRV-EVENTS.md)
