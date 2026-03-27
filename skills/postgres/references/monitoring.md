---
title: Monitoring
description: Essential PostgreSQL monitoring views, pg_stat_statements, logging, host metrics, and statistics management
tags: postgres, monitoring, pg_stat_statements, logging, pgbadger, metrics, operations
---

# Monitoring

## Essential Views

- **pg_stat_activity**: First stop when something is wrong — running queries, states, wait events, locks.
- **pg_stat_statements**: Execution stats for all SQL. Requires `shared_preload_libraries = 'pg_stat_statements'` and `CREATE EXTENSION pg_stat_statements`.
- **pg_stat_database**: Cache hit ratio, temp files, deadlocks, connections per database.
- **pg_stat_user_tables**: `seq_scan` vs `idx_scan`, dead tuples, last vacuum/analyze times.
- **pg_stat_user_indexes**: Find unused indexes (`idx_scan = 0` with large size).
- **pg_stat_bgwriter**: `buffers_clean`, `maxwritten_clean`, `buffers_alloc`. Pre-PG 17 also had `buffers_checkpoint`, `buffers_backend` (high = backends bypassing bgwriter). PG 17+ moved checkpoint stats to `pg_stat_checkpointer`.
- **pg_stat_checkpointer** (PG 17+): Checkpoint frequency (`num_timed`, `num_requested`), write/sync time.

## Key Queries

```sql
-- Slow queries (with cache hit ratio)
SELECT query, calls, mean_exec_time,
  100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS cache_hit_pct
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

-- Connection counts / states
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;

-- Dead tuples (vacuum candidates)
SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;
-- last_autovacuum = <null> means autovacuum has not run on this table
```

Blocking: use `pg_blocking_pids(pid)` with `pg_stat_activity` to find blocked and blocking sessions.

## Logging — First Line of Defense

PostgreSQL is extremely vocal about problems. **Always check logs first**: `tail -f /var/log/postgresql/postgresql-*.log`.

Key settings: `log_min_duration_statement` (OLTP: 1–3s, analytics: 30–60s, dev: 100–500ms). Enable `log_checkpoints=on`, `log_connections=on`, `log_disconnections=on`, `log_lock_waits=on`, `log_temp_files=0`. Use CSV log format for pgBadger analysis; pgBadger generates HTML reports with query stats and performance graphs.

## pg_activity

Interactive top-like tool (pip install pg_activity). Run on DB host for OS metrics alongside PG metrics. Combines `pg_stat_activity` with CPU/memory/I/O context.

## Host Metrics — Critical

PostgreSQL cannot report these. **Monitor them yourself:**

- **CPU**: Steal time >10% in VMs bad; load average > core count; context switches >100k/sec.
- **Memory**: Any swap = performance degradation. Check `dmesg` for OOM kills.
- **Disk I/O**: `iostat -x` — `%util=100%` means saturated; `await` >10ms = high latency.
- **Disk space**: >90% critical (VACUUM fails, writes fail). Check inode usage too.
- **Network**: Packet loss >0% = problems; high retransmits = instability.

## Statistics Management

Stats accumulate since last reset or restart; check `stats_reset` timestamp. `pg_stat_statements_reset()` clears query stats; `pg_stat_reset()` clears database stats. Reset after major maintenance, config changes, or perf testing — not routinely. Prefer snapshotting stats to external monitoring (Prometheus, Datadog) over resetting. **Always confirm with a human before resetting statistics** — resetting destroys historical performance baselines and can make it harder to identify unused indexes or regressions.
