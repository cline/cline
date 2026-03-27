---
title: MySQL Partitioning
description: Partition types and management operations
tags: mysql, partitioning, range, list, hash, maintenance, data-retention
---

# Partitioning

All columns used in the partitioning expression must be part of every UNIQUE/PRIMARY KEY.

## Partition Pruning
The optimizer can eliminate partitions that cannot contain matching rows based on the WHERE clause ("partition pruning"). Partitioning helps most when queries frequently filter by the partition key/expression:
- Equality: `WHERE partition_key = ?` (HASH/KEY)
- Ranges: `WHERE partition_key BETWEEN ? AND ?` (RANGE)
- IN lists: `WHERE partition_key IN (...)` (LIST)

## Types

| Need | Type |
|---|---|
| Time-ordered / data retention | RANGE |
| Discrete categories | LIST |
| Even distribution | HASH / KEY |
| Two access patterns | RANGE + HASH sub |

```sql
-- RANGE COLUMNS (direct date comparisons; avoids function wrapper)
PARTITION BY RANGE COLUMNS (created_at) (
  PARTITION p2025_q1 VALUES LESS THAN ('2025-04-01'),
  PARTITION p_future VALUES LESS THAN (MAXVALUE)
);

-- RANGE with function (use when you must partition by an expression)
PARTITION BY RANGE (TO_DAYS(created_at)) (
  PARTITION p2025_q1 VALUES LESS THAN (TO_DAYS('2025-04-01')),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
-- LIST (discrete categories — unlisted values cause errors, ensure full coverage)
PARTITION BY LIST COLUMNS (region) (
  PARTITION p_americas VALUES IN ('us', 'ca', 'br'),
  PARTITION p_europe  VALUES IN ('uk', 'de', 'fr')
);
-- HASH/KEY (even distribution, equality pruning only)
PARTITION BY HASH (user_id) PARTITIONS 8;
```

## Foreign Key Restrictions (InnoDB)
Partitioned InnoDB tables do not support foreign keys:
- A partitioned table cannot define foreign key constraints to other tables.
- Other tables cannot reference a partitioned table with a foreign key.

If you need foreign keys, partitioning may not be an option.

## When Partitioning Helps vs Hurts
**Helps:**
- Very large tables (millions+ rows) with time-ordered access patterns
- Data retention workflows (drop old partitions vs DELETE)
- Queries that filter by the partition key/expression (enables pruning)
- Maintenance on subsets of data (operate on partitions vs whole table)

**Hurts:**
- Small tables (overhead without benefit)
- Queries that don't filter by the partition key (no pruning)
- Workloads that require foreign keys
- Complex UNIQUE key requirements (partition key columns must be included everywhere)

## Management Operations

```sql
-- Add: split catch-all MAXVALUE partition
ALTER TABLE events REORGANIZE PARTITION p_future INTO (
  PARTITION p2026_01 VALUES LESS THAN (TO_DAYS('2026-02-01')),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
-- Drop aged-out data (orders of magnitude faster than DELETE)
ALTER TABLE events DROP PARTITION p2025_q1;
-- Merge partitions
ALTER TABLE events REORGANIZE PARTITION p2025_01, p2025_02, p2025_03 INTO (
  PARTITION p2025_q1 VALUES LESS THAN (TO_DAYS('2025-04-01'))
);
-- Archive via exchange (LIKE creates non-partitioned copy; both must match structure)
CREATE TABLE events_archive LIKE events;
ALTER TABLE events_archive REMOVE PARTITIONING;
ALTER TABLE events EXCHANGE PARTITION p2025_q1 WITH TABLE events_archive;
```

Notes:
- `REORGANIZE PARTITION` rebuilds the affected partition(s).
- `EXCHANGE PARTITION` requires an exact structure match (including indexes) and the target table must not be partitioned.
- `DROP PARTITION` is DDL (fast) vs `DELETE` (DML; slow on large datasets).

Always ask for human approval before dropping, deleting, or archiving data.
