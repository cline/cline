---
title: Online DDL and Schema Migrations
description: Lock-safe ALTER TABLE guidance
tags: mysql, ddl, schema-migration, alter-table, innodb
---

# Online DDL

Not all `ALTER TABLE` is equal — some block writes for the entire duration.

## Algorithm Spectrum

| Algorithm | What Happens | DML During? |
|---|---|---|
| `INSTANT` | Metadata-only change | Yes |
| `INPLACE` | Rebuilds in background | Usually yes |
| `COPY` | Full table copy to tmp table | **Blocked** |

MySQL picks the fastest available. Specify explicitly to fail-safe:
```sql
ALTER TABLE orders ADD COLUMN note VARCHAR(255) DEFAULT NULL, ALGORITHM=INSTANT;
-- Fails loudly if INSTANT isn't possible, rather than silently falling back to COPY.
```

## What Supports INSTANT (MySQL 8.0+)
- Adding a column (at any position as of 8.0.29; only at end before 8.0.29)
- Dropping a column (8.0.29+)
- Renaming a column (8.0.28+)

**Not INSTANT**: adding indexes (uses INPLACE), dropping indexes (uses INPLACE; typically metadata-only), changing column type, extending VARCHAR (uses INPLACE), adding columns when INSTANT isn't supported for the table/operation.

## Lock Levels
`LOCK=NONE` (concurrent DML), `LOCK=SHARED` (reads only), `LOCK=EXCLUSIVE` (full block), `LOCK=DEFAULT` (server chooses maximum concurrency; default).

Always request `LOCK=NONE` (and an explicit `ALGORITHM`) to surface conflicts early instead of silently falling back to a more blocking method.

## Large Tables (millions+ rows)
Even `INPLACE` operations typically hold brief metadata locks at start/end. The commit phase requires an exclusive metadata lock and will wait for concurrent transactions to finish; long-running transactions can block DDL from completing.

On huge tables, consider external tools:
- **pt-online-schema-change**: creates shadow table, syncs via triggers.
- **gh-ost**: triggerless, uses binlog stream. Preferred for high-write tables.

## Replication Considerations
- DDL replicates to replicas and executes there, potentially causing lag (especially COPY-like rebuilds).
- INSTANT operations minimize replication impact because they complete quickly.
- INPLACE operations can still cause lag and metadata lock waits on replicas during apply.

## PlanetScale Users
On PlanetScale, use **deploy requests** instead of manual DDL tools. Vitess handles non-blocking migrations automatically. Use this whenever possible because it offers much safer schema migrations.

## Key Rule
Never run `ALTER TABLE` on production without checking the algorithm. A surprise `COPY` on a 100M-row table can lock writes for hours.
