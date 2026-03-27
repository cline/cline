---
title: WAL and Checkpoint Operations
description: Write-ahead log internals, checkpoint tuning, durability guarantees, and WAL disk management
tags: postgres, wal, checkpoints, durability, crash-recovery, fsync, operations
---

# WAL and Checkpoint Operations

## WAL Fundamentals

Write-Ahead Logging: logs changes to `pg_wal/` **before** modifying data files. WAL segments are 16MB (fixed at initdb). On COMMIT, PostgreSQL fsyncs WAL to disk and returns SUCCESS — data files are updated lazily. WAL records are written for all changes (including uncommitted transactions and rollbacks). **Never disable `fsync` in production** — power loss without fsync risks unrecoverable data loss.

`wal_level`: `minimal` (crash recovery only), `replica` (default; replication + archiving), `logical` (logical replication).

## Dirty Pages and Checkpoints

A dirty page is modified in shared_buffers but not yet written to data files. A checkpoint flushes all dirty pages to disk and writes a checkpoint record to WAL; recovery only replays WAL since the last checkpoint.

- `checkpoint_timeout` (default 5 min) and `max_wal_size` (default 1GB) — checkpoint on whichever triggers first.
- `checkpoint_completion_target=0.9` spreads I/O over 90% of the interval; avoid spikes.
- "Checkpoints are occurring too frequently" in logs → increase `max_wal_size`.
- **Target: >90% of checkpoints should be time-based** (`num_timed` in `pg_stat_checkpointer`), not size-based (`num_requested`). If num_requested/(num_timed+num_requested) > 10%, tune `max_wal_size` up.

## WAL Disk Management

Replication slots prevent WAL deletion even when standbys are offline — they can fill disk. WAL archiving failures also block recycling. `max_wal_size` is a *soft* limit; WAL can grow beyond it under heavy load.

WAL size: `SELECT count(*) AS files, pg_size_pretty(sum(size)) AS total FROM pg_ls_waldir();`

Slot lag: `SELECT slot_name, pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS lag_bytes FROM pg_replication_slots;`

## Checkpoint Monitoring

PG17+ moved checkpoint stats from `pg_stat_bgwriter` to `pg_stat_checkpointer` and renamed columns.

`SELECT num_timed, num_requested, write_time, sync_time, buffers_written FROM pg_stat_checkpointer;`

Backend-direct writes (formerly `buffers_backend` in `pg_stat_bgwriter`) are now tracked in `pg_stat_io`: `SELECT writes FROM pg_stat_io WHERE backend_type = 'client backend' AND object = 'relation';`

## Crash Recovery

On crash, PostgreSQL replays WAL from the last checkpoint. Longer checkpoint intervals → more WAL to replay → longer recovery. Trade-off: frequent checkpoints (faster recovery, more I/O) vs infrequent (less I/O, slower recovery). For most workloads, `checkpoint_timeout=5min` and `max_wal_size` tuned to keep checkpoints time-based is the right balance.
