---
title: MVCC and VACUUM
description: MVCC internals, VACUUM/autovacuum tuning, and bloat prevention
tags: postgres, mvcc, vacuum, autovacuum, xid, bloat, dead-tuples
---

# MVCC and VACUUM

## MVCC

Every `UPDATE` creates a new tuple and marks the old one dead; `DELETE` marks tuples dead. Dead tuples accumulate until `VACUUM` reclaims space. Each transaction gets a 32-bit XID (2^32 ≈ 4B values, but modular comparison means the effective danger zone is 2^31 ≈ 2B). VACUUM must freeze old XIDs to prevent wraparound.

## VACUUM vs VACUUM FULL

`VACUUM` is non-blocking (ShareUpdateExclusive lock) and marks dead space reusable. `VACUUM FULL` rewrites the table and requires an AccessExclusive lock — use only as a last resort. For online bloat reduction prefer `pg_squeeze` or `pg_repack`.

## Autovacuum Tuning

Triggers when dead tuples > `Min(autovacuum_vacuum_max_threshold, autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * reltuples)`. `autovacuum_vacuum_max_threshold` defaults to 100M (PG 18+), capping the threshold for very large tables. Also triggers on inserts exceeding `autovacuum_vacuum_insert_threshold + autovacuum_vacuum_insert_scale_factor * reltuples * pct_not_frozen` (ensures insert-only tables get frozen; PG 13+). For large/hot tables, set per-table overrides:

- `autovacuum_vacuum_scale_factor` — default 0.2; lower to 0.01–0.05 for large tables.
- `autovacuum_vacuum_cost_delay` — default 2 ms; set to 0 on fast storage.
- `autovacuum_vacuum_cost_limit` — default -1 (uses `vacuum_cost_limit`, effectively 200); raise to 1000–2000 on fast storage.
- `autovacuum_freeze_max_age` — default 200M; triggers anti-wraparound vacuum.
- `vacuum_failsafe_age` — default 1.6B; last-resort mode (PG 14+) that disables throttling and skips index vacuuming when wraparound is imminent.

## Key Monitoring Queries

Dead tuples: `SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;`

XID age: `SELECT datname, age(datfrozenxid) AS xid_age FROM pg_database ORDER BY xid_age DESC;`

Long transactions: `SELECT pid, state, now() - xact_start AS tx_age FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY xact_start;`

## Best Practices

- Keep transactions short; set `idle_in_transaction_session_timeout` (30s–5min).
- Alert when `age(datfrozenxid)` exceeds 40–50% of wraparound (~800M–1B).
- Tune autovacuum per-table for write-heavy tables; don't change global defaults first.
- Fix application transaction scope before adjusting vacuum parameters.
- Never disable autovacuum globally.
