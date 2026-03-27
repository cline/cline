---
title: Composite Index Design
description: Multi-column indexes
tags: mysql, indexes, composite, query-optimization, leftmost-prefix
---

# Composite Indexes

## Leftmost Prefix Rule
Index `(a, b, c)` is usable for:
- `WHERE a` (uses column `a`)
- `WHERE a AND b` (uses columns `a`, `b`)
- `WHERE a AND b AND c` (uses all columns)
- `WHERE a AND c` (uses only column `a`; `c` can't filter without `b`)

NOT usable for `WHERE b` alone or `WHERE b AND c` (the search must start from the leftmost column).

## Column Order: Equality First, Then Range/Sort

```sql
-- Query: WHERE tenant_id = ? AND status = ? AND created_at > ?
CREATE INDEX idx_orders_tenant_status_created ON orders (tenant_id, status, created_at);
```

**Critical**: Range predicates (`>`, `<`, `BETWEEN`, `LIKE 'prefix%'`, and sometimes large `IN (...)`) stop index usage for filtering subsequent columns. However, columns after a range predicate can still be useful for:
- Covering index reads (avoid table lookups)
- `ORDER BY`/`GROUP BY` in some cases, when the ordering/grouping matches the usable index prefix

## Sort Order Must Match Index

```sql
-- Index: (status, created_at)
ORDER BY status ASC, created_at ASC   -- ✓ matches (optimal)
ORDER BY status DESC, created_at DESC -- ✓ full reverse OK (reverse scan)
ORDER BY status ASC, created_at DESC  -- ⚠️ mixed directions (may use filesort)

-- MySQL 8.0+: descending index components
CREATE INDEX idx_orders_status_created ON orders (status ASC, created_at DESC);
```

## Composite vs Multiple Single-Column Indexes
MySQL can merge single-column indexes (`index_merge` union/intersection) but a composite index is typically faster. Index merge is useful when queries filter on different column combinations that don't share a common prefix, but it adds overhead and may not scale well under load.

## Selectivity Considerations
Within equality columns, place higher-cardinality (more selective) columns first when possible. However, query patterns and frequency usually matter more than pure selectivity.

## GROUP BY and Composite Indexes
`GROUP BY` can benefit from composite indexes when the GROUP BY columns match the index prefix. MySQL may use the index to avoid sorting.

## Design for Multiple Queries

```sql
-- One index covers: WHERE user_id=?, WHERE user_id=? AND status=?,
--   and WHERE user_id=? AND status=? ORDER BY created_at DESC
CREATE INDEX idx_orders_user_status_created ON orders (user_id, status, created_at DESC);
```

## InnoDB Secondary Index Behavior
InnoDB secondary indexes implicitly store the primary key value with each index entry. This means a secondary index can sometimes "cover" primary key lookups without adding the PK columns explicitly.
