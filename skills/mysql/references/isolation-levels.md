---
title: InnoDB Transaction Isolation Levels
description: Best practices for choosing and using isolation levels
tags: mysql, transactions, isolation, innodb, locking, concurrency
---

# Isolation Levels (InnoDB Best Practices)

**Default to REPEATABLE READ.** It is the InnoDB default, most tested, and prevents phantom reads. Only change per-session with a measured reason.

```sql
SELECT @@transaction_isolation;
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;  -- per-session only
```

## Autocommit Interaction
- Default: `autocommit=1` (each statement is its own transaction).
- With `autocommit=0`, transactions span multiple statements until `COMMIT`/`ROLLBACK`.
- Isolation level applies per transaction. SERIALIZABLE behavior differs based on autocommit setting (see SERIALIZABLE section).

## Locking vs Non-Locking Reads
- **Non-locking reads**: plain `SELECT` statements use consistent reads (MVCC snapshots). They don't acquire locks and don't block writers.
- **Locking reads**: `SELECT ... FOR UPDATE` (exclusive) or `SELECT ... FOR SHARE` (shared) acquire locks and can block concurrent modifications.
- `UPDATE` and `DELETE` statements are implicitly locking reads.

## REPEATABLE READ (Default — Prefer This)
- Consistent reads: snapshot established at first read; all plain SELECTs within the transaction read from that same snapshot (MVCC). Plain SELECTs are non-locking and don't block writers.
- Locking reads/writes use **next-key locks** (row + gap) — prevents phantoms. Exception: a unique index with a unique search condition locks only the index record, not the gap.
- **Use for**: OLTP, check-then-insert, financial logic, reports needing consistent snapshots.
- **Avoid mixing** locking statements (`SELECT ... FOR UPDATE`, `UPDATE`, `DELETE`) with non-locking `SELECT` statements in the same transaction — they can observe different states (current vs snapshot) and lead to surprises.

## READ COMMITTED (Per-Session Only, When Needed)
- Fresh snapshot per SELECT; **record locks only** (gap locks disabled for searches/index scans, but still used for foreign-key and duplicate-key checks) — more concurrency, but phantoms possible.
- **Switch only when**: gap-lock deadlocks confirmed via `SHOW ENGINE INNODB STATUS`, bulk imports with contention, or high-write concurrency on overlapping ranges.
- **Never switch globally.** Check-then-insert patterns break — use `INSERT ... ON DUPLICATE KEY` or `FOR UPDATE` instead.

## SERIALIZABLE — Avoid
Converts all plain SELECTs to `SELECT ... FOR SHARE` **if autocommit is disabled**. If autocommit is enabled, SELECTs are consistent (non-locking) reads. SERIALIZABLE can cause massive contention when autocommit is disabled. Prefer explicit `SELECT ... FOR UPDATE` at REPEATABLE READ instead — same safety, far less lock scope.

## READ UNCOMMITTED — Never Use
Dirty reads with no valid production use case.

## Decision Guide
| Scenario | Recommendation |
|---|---|
| General OLTP / check-then-insert / reports | **REPEATABLE READ** (default) |
| Bulk import or gap-lock deadlocks | **READ COMMITTED** (per-session), benchmark first |
| Need serializability | Explicit `FOR UPDATE` at REPEATABLE READ; SERIALIZABLE only as last resort |

