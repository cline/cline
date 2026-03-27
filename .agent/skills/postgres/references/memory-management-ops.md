---
title: Memory Architecture and OOM Prevention
description: PostgreSQL shared/private memory layout, OS page cache interaction, and OOM avoidance strategies
tags: postgres, memory, shared_buffers, work_mem, oom, architecture, operations
---

# Memory Architecture and OOM Prevention

## Memory Areas

- **Shared memory**: `shared_buffers` — main data cache, all processes, requires restart to change.
- **Private per backend**: `work_mem` (sorts/hashes/joins, per-operation); `maintenance_work_mem` (VACUUM, CREATE INDEX, ALTER TABLE ADD FOREIGN KEY); `temp_buffers` (8MB default).
- **Planner hint only**: `effective_cache_size` is NOT allocated — set to ~50–75% of total RAM.
- **Hash multiplier**: `hash_mem_multiplier` (default 2.0) means hash ops use up to 2× `work_mem`.

## Memory Multiplication Danger

Maximum potential: `work_mem × operations_per_query × (parallel_workers + 1) × connections` (leader participates by default via `parallel_leader_participation = on`; hash operations use up to `hash_mem_multiplier × work_mem`, default 2.0). Example: 128MB work_mem, 3 ops (2 sorts + 1 hash join), 2 parallel workers, 100 connections → 2 sorts at 128MB = 256MB, 1 hash join at 128MB × 2.0 = 256MB, per process = 512MB, × 3 processes (2 workers + leader) = 1536MB/query, × 100 connections = **~150GB** worst case. This case is rare.
Not all queries hit limits at once, but high concurrency + large datasets approach it. This is a common cause of OOM in containerized/Kubernetes deployments. Plan capacity with a 1.5–2× safety margin.

## OS Page Cache (Double Buffering)

Data exists in both `shared_buffers` and OS page cache. A miss in shared_buffers can still hit OS cache (avoiding disk I/O). Extremely large shared_buffers can hurt performance: less OS cache, slower startup, heavier checkpoints. Optimal split depends on workload (OLTP vs OLAP).

## OOM Prevention

- Implement connection pooling to reduce total backend count.
- Reduce `work_mem` globally; use per-session overrides for heavy queries only.
- Lower `max_parallel_workers_per_gather` in high-concurrency systems.
- Set `statement_timeout` to kill runaway queries.
- Monitor: `dmesg -T | grep "killed process"` and `temp_blks_written` in pg_stat_statements.

## Operational Rules

- Tune per-session first, global last.
- Suspect OOM when memory spikes during high concurrency, dashboards, or large batch jobs.
- Increase memory only after confirming spill behavior (`temp_blks_written > 0`).
- `maintenance_work_mem` can be set much higher (1–2GB) — fewer processes use it. Cap autovacuum with `autovacuum_work_mem` to avoid `autovacuum_max_workers × maintenance_work_mem` memory spikes.
- `shared_buffers` change requires full restart; `work_mem` is per-session changeable.
