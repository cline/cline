---
title: Covering Indexes
description: Index-only scans
tags: mysql, indexes, covering-index, query-optimization, explain
---

# Covering Indexes

A covering index contains all columns a query needs — InnoDB satisfies it from the index alone (`Using index` in EXPLAIN Extra).

```sql
-- Query: SELECT user_id, status, total FROM orders WHERE user_id = 42
-- Covering index (filter columns first, then included columns):
CREATE INDEX idx_orders_cover ON orders (user_id, status, total);
```

## InnoDB Implicit Covering
Because InnoDB secondary indexes store the primary key value with each index entry, `INDEX(status)` already covers `SELECT id FROM t WHERE status = ?` (where `id` is the PK).

## ICP vs Covering Index
- **ICP (`Using index condition`)**: engine filters at the index level before accessing table rows, but still requires table lookups.
- **Covering index (`Using index`)**: query is satisfied entirely from the index, with no table lookups.

## EXPLAIN Signals
Look for `Using index` in the `Extra` column:

```sql
EXPLAIN SELECT user_id, status, total FROM orders WHERE user_id = 42;
-- Extra: Using index ✓
```

If you see `Using index condition` instead, the index is helping but not covering — you may need to add selected columns to the index.

## When to Use
- High-frequency reads selecting few columns from wide tables.
- Not worth it for: wide result sets (TEXT/BLOB), write-heavy tables, low-frequency queries.

## Tradeoffs
- **Write amplification**: every INSERT/UPDATE/DELETE must update all relevant indexes.
- **Index size**: wide indexes consume more disk and buffer pool memory.
- **Maintenance**: larger indexes take longer to rebuild during `ALTER TABLE`.

## Guidelines
- Add columns to existing indexes rather than creating new ones.
- Order: filter columns first, then additional covered columns.
- Verify `Using index` appears in EXPLAIN after adding the index.
- **Pitfall**: `SELECT *` defeats covering indexes — select only the columns you need.
