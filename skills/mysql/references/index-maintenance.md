---
title: Index Maintenance and Cleanup
description: Index maintenance
tags: mysql, indexes, maintenance, unused-indexes, performance
---

# Index Maintenance

## Find Unused Indexes

```sql
-- Requires performance_schema enabled (default in MySQL 5.7+)
-- "Unused" here means no reads/writes since last restart.
SELECT object_schema, object_name, index_name, COUNT_READ, COUNT_WRITE
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = 'mydb'
  AND index_name IS NOT NULL AND index_name != 'PRIMARY'
  AND COUNT_READ = 0 AND COUNT_WRITE = 0
ORDER BY COUNT_WRITE DESC;
```

Sometimes you'll also see indexes with **writes but no reads** (overhead without query benefit). Review these carefully: some are required for constraints (UNIQUE/PK) even if not used in query plans.

```sql
SELECT object_schema, object_name, index_name, COUNT_READ, COUNT_WRITE
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE object_schema = 'mydb'
  AND index_name IS NOT NULL AND index_name != 'PRIMARY'
  AND COUNT_READ = 0 AND COUNT_WRITE > 0
ORDER BY COUNT_WRITE DESC;
```

Counters reset on restart — ensure 1+ full business cycle of uptime before dropping.

## Find Redundant Indexes

Index on `(a)` is redundant if `(a, b)` exists (leftmost prefix covers it). Pairs sharing only the first column (e.g. `(a,b)` vs `(a,c)`) need manual review — neither is redundant.

```sql
-- Prefer sys schema view (MySQL 5.7.7+)
SELECT table_schema, table_name,
  redundant_index_name, redundant_index_columns,
  dominant_index_name, dominant_index_columns
FROM sys.schema_redundant_indexes
WHERE table_schema = 'mydb';
```

## Check Index Sizes

```sql
SELECT database_name, table_name, index_name,
  ROUND(stat_value * @@innodb_page_size / 1024 / 1024, 2) AS size_mb
FROM mysql.innodb_index_stats
WHERE stat_name = 'size' AND database_name = 'mydb'
ORDER BY stat_value DESC;
-- stat_value is in pages; multiply by innodb_page_size for bytes
```

## Index Write Overhead
Each index must be updated on INSERT, UPDATE, and DELETE operations. More indexes = slower writes.

- **INSERT**: each secondary index adds a write
- **UPDATE**: changing indexed columns updates all affected indexes
- **DELETE**: removes entries from all indexes

InnoDB can defer some secondary index updates via the change buffer, but excessive indexing still reduces write throughput.

## Update Statistics (ANALYZE TABLE)
The optimizer relies on index cardinality and distribution statistics. After large data changes, refresh statistics:

```sql
ANALYZE TABLE orders;
```

This updates statistics (does not rebuild the table).

## Rebuild / Reclaim Space (OPTIMIZE TABLE)
`OPTIMIZE TABLE` can reclaim space and rebuild indexes:

```sql
OPTIMIZE TABLE orders;
```

For InnoDB this effectively rebuilds the table and indexes and can be slow on large tables.

## Invisible Indexes (MySQL 8.0+)
Test removing an index without dropping it:

```sql
ALTER TABLE orders ALTER INDEX idx_status INVISIBLE;
ALTER TABLE orders ALTER INDEX idx_status VISIBLE;
```

Invisible indexes are still maintained on writes (overhead remains), but the optimizer won't consider them.

## Index Maintenance Tools

### Online DDL (Built-in)
Most add/drop index operations are online-ish but still take brief metadata locks:

```sql
ALTER TABLE orders ADD INDEX idx_status (status), ALGORITHM=INPLACE, LOCK=NONE;
```

### pt-online-schema-change / gh-ost
For very large tables or high-write workloads, online schema change tools can reduce blocking by using a shadow table and a controlled cutover (tradeoffs: operational complexity, privileges, triggers/binlog requirements).

## Guidelines
- 1–5 indexes per table is normal. 6+: audit for redundancy.
- Combine `performance_schema` data with `EXPLAIN` of frequent queries monthly.
