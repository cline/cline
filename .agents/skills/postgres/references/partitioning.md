---
title: Table Partitioning Guide
description: Partition guide
tags: postgres, partitioning, range, list, pg_partman, data-retention
---

# Table Partitioning

Plan partitioning upfront for tables expected to grow large. Retrofitting later requires a migration.

## When to Partition

Partitioning benefits maintenance (vacuum, index builds) and data retention more than pure query speed.

| Table Type | Size Threshold | Row Threshold |
| --- | --- | --- |
| General tables | >100 GB (or >RAM) | >20M rows |
| Time-series / logs | >50 GB | >10M rows |

Use the lower thresholds for append-heavy, time-ordered data with retention needs (logs, events, audit trails, metrics).

## Range Partitioning (Most Common)

```sql
-- EXAMPLE
CREATE TABLE event (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at) -- Partition key MUST be part of PK
) PARTITION BY RANGE (created_at);

CREATE TABLE event_2026_01 PARTITION OF event
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE event_2026_02 PARTITION OF event
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

## List Partitioning

Useful for partitioning by region, tenant, or category:

```sql
-- EXAMPLE
CREATE TABLE order (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  region TEXT NOT NULL,
  total NUMERIC(10,2),
  PRIMARY KEY (id, region) -- Partition key MUST be part of PK
) PARTITION BY LIST (region);

CREATE TABLE order_us PARTITION OF order FOR VALUES IN ('us');
CREATE TABLE order_eu PARTITION OF order FOR VALUES IN ('eu');
CREATE TABLE order_default PARTITION OF order DEFAULT;  -- catches unmatched values
```

## Partition Management

- Use `pg_partman` (extension) to automate partition creation and cleanup.
- Use `DETACH PARTITION` to remove a partition while retaining it as a standalone table (e.g., for archiving).
- Use `DETACH PARTITION ... CONCURRENTLY` (PG 14+) to avoid `ACCESS EXCLUSIVE` locks on the parent table.
- Drop old partitions for data retention instead of `DELETE` to avoid vacuum overhead and bloat.
- Create future partitions ahead of time to avoid insert failures.
- **Always confirm with a human before detaching or dropping partitions.** These are destructive actions — detaching removes data from the partitioned table, and dropping permanently deletes the data.

```sql
-- DESTRUCTIVE: confirm with a human before executing
ALTER TABLE event DETACH PARTITION event_2025_01 CONCURRENTLY;
DROP TABLE event_2025_01;
```

## Guidelines & Limitations

- **Primary Keys**: Partition key columns MUST be included in the `PRIMARY KEY` and any `UNIQUE` constraints.
- **Global Uniqueness**: Global unique constraints on non-partition columns are NOT supported.
- **Indexes**: Indexes defined on the parent are automatically created on all partitions (and future ones).
- **Pruning**: Ensure queries filter by the partition key to enable "partition pruning" (skipping unrelated partitions).
