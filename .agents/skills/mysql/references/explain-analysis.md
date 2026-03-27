---
title: EXPLAIN Plan Analysis
description: EXPLAIN output guide
tags: mysql, explain, query-plan, performance, indexes
---

# EXPLAIN Analysis

```sql
EXPLAIN SELECT ...;                    -- estimated plan
EXPLAIN FORMAT=JSON SELECT ...;        -- detailed with cost estimates
EXPLAIN FORMAT=TREE SELECT ...;        -- tree format (8.0+)
EXPLAIN ANALYZE SELECT ...;            -- actual execution (8.0.18+, runs the query, uses TREE format)
```

## Access Types (Best → Worst)
`system` → `const` → `eq_ref` → `ref` → `range` → `index` (full index scan) → `ALL` (full table scan)

Target `ref` or better. `ALL` on >1000 rows almost always needs an index.

## Key Extra Flags
| Flag | Meaning | Action |
|---|---|---|
| `Using index` | Covering index (optimal) | None |
| `Using filesort` | Sort not via index | Index the ORDER BY columns |
| `Using temporary` | Temp table for GROUP BY | Index the grouped columns |
| `Using join buffer` | No index on join column | Add index on join column |
| `Using index condition` | ICP — engine filters at index level | Generally good |

## key_len — How Much of Composite Index Is Used
Byte sizes: `TINYINT`=1, `INT`=4, `BIGINT`=8, `DATE`=3, `DATETIME`=5, `VARCHAR(N)` utf8mb4: N×4+1 (or +2 when N×4>255). Add 1 byte per nullable column.

```sql
-- Index: (status TINYINT, created_at DATETIME)
-- key_len=2 → only status (1+1 null). key_len=8 → both columns used.
```

## rows vs filtered
- `rows`: estimated rows examined after index access (before additional WHERE filtering)
- `filtered`: percent of examined rows expected to pass the full WHERE conditions
- Rough estimate of rows that satisfy the query: `rows × filtered / 100`
- Low `filtered` often means additional (non-indexed) predicates are filtering out lots of rows

## Join Order
Row order in EXPLAIN output reflects execution order: the first row is typically the first table read, and subsequent rows are joined in order. Use this to spot suboptimal join ordering (e.g., starting with a large table when a selective table could drive the join).

## EXPLAIN ANALYZE
**Availability:** MySQL 8.0.18+

**Important:** `EXPLAIN ANALYZE` actually executes the query (it does not return the result rows). It uses `FORMAT=TREE` automatically.

**Metrics (TREE output):**
- `actual time`: milliseconds (startup → end)
- `rows`: actual rows produced by that iterator
- `loops`: number of times the iterator ran

Compare estimated vs actual to find optimizer misestimates. Large discrepancies often improve after refreshing statistics:

```sql
ANALYZE TABLE your_table;
```

**Limitations / pitfalls:**
- Adds instrumentation overhead (measurements are not perfectly "free")
- Cost units (arbitrary) and time (ms) are different; don't compare them directly
- Results reflect real execution, including buffer pool/cache effects (warm cache can hide I/O problems)
