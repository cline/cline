---
title: Index Optimization Queries
description: Index audit queries
tags: postgres, indexes, unused-indexes, duplicate-indexes, invalid-indexes, bloat, HOT, write-amplification, planner-tuning, optimization
---

# Index Optimization

## Identify Unused Indexes

Query to find unused indexes:

```sql
-- indexes with 0 scans (check pg_stat_reset / pg_postmaster_start_time first)
SELECT
   s.schemaname,
   s.relname AS table_name,
   s.indexrelname AS index_name,
   pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size
 FROM pg_catalog.pg_stat_user_indexes s
 JOIN pg_catalog.pg_index i ON s.indexrelid = i.indexrelid
 WHERE s.idx_scan = 0
   AND 0 <> ALL (i.indkey)       -- exclude expression indexes
   AND NOT i.indisunique          -- exclude UNIQUE indexes
   AND NOT EXISTS (               -- exclude constraint-backing indexes
     SELECT 1 FROM pg_catalog.pg_constraint c
     WHERE c.conindid = s.indexrelid
   )
 ORDER BY pg_relation_size(s.indexrelid) DESC;
```

## Identify Duplicate Indexes

Indexes with identical definitions (after normalizing names) on the same table are duplicates:

```sql
SELECT
  schemaname || '.' || tablename AS table,
  array_agg(indexname) AS duplicate_indexes,
  pg_size_pretty(sum(pg_relation_size((schemaname || '.' || indexname)::regclass))) AS total_size
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
GROUP BY schemaname, tablename,
  regexp_replace(indexdef, 'INDEX \S+ ON ', 'INDEX ON ')
HAVING count(*) > 1;
```

> **Warning:** Confirm with a human before dropping duplicate indexes. Some "duplicates" differ in practical use (operator classes, collations, predicates, sort order) and may be required for critical workloads.

## Identify Invalid Indexes

Failed `CREATE INDEX CONCURRENTLY` builds leave INVALID indexes maintained on every write but never used for reads.
`CREATE INDEX CONCURRENTLY IF NOT EXISTS` silently succeeds if an invalid index already exists — always check and drop before retrying.

```sql
SELECT indexrelname FROM pg_stat_user_indexes s
JOIN pg_index i ON s.indexrelid = i.indexrelid WHERE NOT i.indisvalid;
```

> **Warning:** Confirm with a human before dropping invalid indexes. Validate index health and workload impact first, then drop/rebuild during a controlled window.

## Per-table Index Count Guidelines

| Index Count | Recommendation                              |
| ----------- | ------------------------------------------- |
| <5          | Normal                                      |
| 5-10        | Review for unused/duplicates                |
| >10         | Audit required - significant write overhead |

```sql
SELECT relname AS table, count(*) as index_count
FROM pg_stat_user_indexes
GROUP BY relname
ORDER BY count(*) DESC;
```

## Index Bloat Detection

VACUUM removes dead tuples but does **not** reclaim empty index page space — only `REINDEX` or `pg_repack` compacts pages.
Detect with `pgstattuple`:

```sql
CREATE EXTENSION IF NOT EXISTS pgstattuple;
SELECT avg_leaf_density FROM pgstatindex('my_index');
```

Below 70% = significant bloat, healthy = 80-90%+. Remediation: `REINDEX CONCURRENTLY` (PG 12+) for index-only bloat; `pg_repack` for table+index (requires PK and ~2x disk space).

## HOT Update Monitoring

HOT updates skip all index maintenance when no indexed column value changes and free space exists on the same heap page. Target >90% on frequently updated tables.

```sql
SELECT relname, round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables WHERE n_tup_upd > 0 ORDER BY n_tup_upd DESC;
```

**Key levers:** set `fillfactor = 70-80` on write-heavy tables, never index frequently-updated columns (`status`, `updated_at`) unless query-critical, use partial indexes to reduce scope. PG 16+: BRIN indexes excluded from HOT eligibility checks.

## Write Amplification

Each additional index adds write-path overhead because every INSERT/UPDATE/DELETE must maintain more index entries. In a [Percona PG 17.4 over-indexing benchmark](https://www.percona.com/blog/benchmarking-postgresql-the-hidden-cost-of-over-indexing/), moving from 7 to 39 indexes showed a **58% throughput drop**.

To reduce WAL volume from this extra write activity, enable `wal_compression` (available before PG 15; `lz4` and `zstd` options are PG 15+). Tune `max_wal_size` separately to reduce checkpoint frequency under sustained write load.

## Planner Tuning

- **SSD storage:** `random_page_cost = 1.1` (default 4.0 assumes spinning disk)
- **effective_cache_size:** ~75% of total RAM
- **Correlated columns:** `CREATE STATISTICS (dependencies, ndistinct, mcv)` then ANALYZE
- **Skewed distributions:** `ALTER TABLE ... ALTER COLUMN ... SET STATISTICS 500-1000`
