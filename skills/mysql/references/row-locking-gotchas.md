---
title: InnoDB Row Locking Gotchas
description: Gap locks, next-key locks, and surprise escalation
tags: mysql, innodb, locking, gap-locks, next-key-locks, concurrency
---

# Row Locking Gotchas

InnoDB uses row-level locking, but the actual locked range is often wider than expected.

## Next-Key Locks (REPEATABLE READ)
InnoDB's default isolation level uses next-key locks for **locking reads** (`SELECT ... FOR UPDATE`, `SELECT ... FOR SHARE`, `UPDATE`, `DELETE`) to prevent phantom reads. A range scan locks every gap in that range. Plain `SELECT` statements use consistent reads (MVCC) and don't acquire locks.

**Exception**: a unique index search with a unique search condition (e.g., `WHERE id = 5` on a unique `id`) locks only the index record, not the gap. Gap/next-key locks still apply for range scans and non-unique searches.

```sql
-- Locks rows with id 5..10 AND the gaps between them and after the range
SELECT * FROM orders WHERE id BETWEEN 5 AND 10 FOR UPDATE;
-- Another session inserting id=7 blocks until the lock is released.
```

## Gap Locks on Non-Existent Rows
`SELECT ... FOR UPDATE` on a row that doesn't exist still places a gap lock:
```sql
-- No row with id=999 exists, but this locks the gap around where 999 would be
SELECT * FROM orders WHERE id = 999 FOR UPDATE;
-- Concurrent INSERTs into that gap are blocked.
```

## Index-Less UPDATE/DELETE = Full Scan and Broad Locking
If the WHERE column has no index, InnoDB must scan all rows and locks every row examined (often effectively all rows in the table). This is not table-level locking—InnoDB doesn't escalate locks—but rather row-level locks on all rows:
```sql
-- No index on status → locks all rows (not a table lock, but all row locks)
UPDATE orders SET processed = 1 WHERE status = 'pending';
-- Fix: CREATE INDEX idx_status ON orders (status);
```

## SELECT ... FOR SHARE (Shared Locks)
`SELECT ... FOR SHARE` acquires shared (S) locks instead of exclusive (X) locks. Multiple sessions can hold shared locks simultaneously, but exclusive locks are blocked:

```sql
-- Session 1: shared lock
SELECT * FROM orders WHERE id = 5 FOR SHARE;

-- Session 2: also allowed (shared lock)
SELECT * FROM orders WHERE id = 5 FOR SHARE;

-- Session 3: blocked until shared locks are released
UPDATE orders SET status = 'processed' WHERE id = 5;
```

Gap/next-key locks can still apply in REPEATABLE READ, so inserts into locked gaps may be blocked even with shared locks.

## INSERT ... ON DUPLICATE KEY UPDATE
Takes an exclusive next-key lock on the index entry. If multiple sessions do this concurrently on nearby key values, gap-lock deadlocks are common.

## Lock Escalation Misconception
InnoDB does **not** automatically escalate row locks to table locks. When a missing index causes "table-wide" locking, it's because InnoDB scans and locks all rows individually—not because locks were escalated.

## Mitigation Strategies
- **Use READ COMMITTED** when gap locks cause excessive blocking (gap locks disabled in RC except for FK/duplicate-key checks).
- **Keep transactions short** — hold locks for milliseconds, not seconds.
- **Ensure WHERE columns are indexed** to avoid full-table lock scans.
