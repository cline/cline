---
title: InnoDB Deadlock Resolution
description: Deadlock diagnosis
tags: mysql, deadlocks, innodb, transactions, locking, concurrency
---

# Deadlocks

InnoDB auto-detects deadlocks and rolls back one transaction (the "victim").

## Common Causes
1. **Opposite row ordering** — Transactions accessing the same rows in different order can deadlock. Fix: always access rows in a consistent order (typically by primary key or a common index) so locks are acquired in the same sequence.
2. **Next-key lock conflicts** (REPEATABLE READ) — InnoDB uses next-key locks (row + gap) to prevent phantoms. Fix: use READ COMMITTED (reduces gap locking) or narrow lock scope.
3. **Missing index on WHERE column** — UPDATE/DELETE without an index may require a full table scan, locking many rows unnecessarily and increasing deadlock risk.
4. **AUTO_INCREMENT lock contention** — Concurrent INSERT patterns can deadlock while contending on the auto-inc lock. Fix: use `innodb_autoinc_lock_mode=2` (interleaved) for better concurrency when safe for your workload, or batch inserts.

Note: SERIALIZABLE also uses gap/next-key locks. READ COMMITTED reduces some gap-lock deadlocks but doesn't eliminate deadlocks from opposite ordering or missing indexes.

## Diagnosing

```sql
-- Last deadlock details
SHOW ENGINE INNODB STATUS\G
-- Look for "LATEST DETECTED DEADLOCK" section

-- Current lock waits (MySQL 8.0+)
SELECT object_name, lock_type, lock_mode, lock_status, lock_data
FROM performance_schema.data_locks WHERE lock_status = 'WAITING';

-- Lock wait relationships (MySQL 8.0+)
SELECT
  w.requesting_thread_id,
  w.requested_lock_id,
  w.blocking_thread_id,
  w.blocking_lock_id,
  l.lock_type,
  l.lock_mode,
  l.lock_data
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks l ON w.requested_lock_id = l.lock_id;
```

## Prevention
- Keep transactions short. Do I/O outside transactions.
- Ensure WHERE columns in UPDATE/DELETE are indexed.
- Use `SELECT ... FOR UPDATE` sparingly. Batch large updates with `LIMIT`.
- Access rows in a consistent order (by PK or index) across all transactions.

## Retry Pattern (Error 1213)

In applications, retries are a common workaround for occasional deadlocks.

**Important**: ensure the operation is idempotent (or can be safely retried) before adding automatic retries, especially if there are side effects outside the database.

```pseudocode
def execute_with_retry(db, fn, max_retries=3):
    for attempt in range(max_retries):
        try:
            with db.begin():
                return fn()
        except OperationalError as e:
            if e.args[0] == 1213 and attempt < max_retries - 1:
                time.sleep(0.05 * (2 ** attempt))
                continue
            raise
```

## Common Misconceptions
- **"Deadlocks are bugs"** — deadlocks are a normal part of concurrent systems. The goal is to minimize frequency, not eliminate them entirely.
- **"READ COMMITTED eliminates deadlocks"** — it reduces gap/next-key lock deadlocks, but deadlocks still happen from opposite ordering, missing indexes, and lock contention.
- **"All deadlocks are from gap locks"** — many are caused by opposite row ordering even without gap locks.
- **"Victim selection is random"** — InnoDB generally chooses the transaction with lower rollback cost (fewer rows changed).
