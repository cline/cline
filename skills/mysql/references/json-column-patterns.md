---
title: JSON Column Best Practices
description: When and how to use JSON columns safely
tags: mysql, json, generated-columns, indexes, data-modeling
---

# JSON Column Patterns

MySQL 5.7+ supports native JSON columns. Useful, but with important caveats.

## When JSON Is Appropriate
- Truly schema-less data (user preferences, metadata bags, webhook payloads).
- Rarely filtered/joined — if you query a JSON path frequently, extract it to a real column.

## Indexing JSON: Use Generated Columns
You **cannot** index a JSON column directly. Create a virtual generated column and index that:
```sql
ALTER TABLE events
  ADD COLUMN event_type VARCHAR(50) GENERATED ALWAYS AS (data->>'$.type') VIRTUAL,
  ADD INDEX idx_event_type (event_type);
```

## Extraction Operators
| Syntax | Returns | Use for |
|---|---|---|
| `JSON_EXTRACT(col, '$.key')` | JSON type value (e.g., `"foo"` for strings) | When you need JSON type semantics |
| `col->'$.key'` | Same as `JSON_EXTRACT(col, '$.key')` | Shorthand |
| `col->>'$.key'` | Unquoted scalar (equivalent to `JSON_UNQUOTE(JSON_EXTRACT(col, '$.key'))`) | WHERE comparisons, display |

Always use `->>` (unquote) in WHERE clauses, otherwise you compare against `"foo"` (with quotes).

Tip: the generated column example above can be written more concisely as:

```sql
ALTER TABLE events
  ADD COLUMN event_type VARCHAR(50) GENERATED ALWAYS AS (data->>'$.type') VIRTUAL,
  ADD INDEX idx_event_type (event_type);
```

## Multi-Valued Indexes (MySQL 8.0.17+)
If you store arrays in JSON (e.g., `tags: ["electronics","sale"]`), MySQL 8.0.17+ supports multi-valued indexes to index array elements:

```sql
ALTER TABLE products
  ADD INDEX idx_tags ((CAST(tags AS CHAR(50) ARRAY)));
```

This can accelerate membership queries such as:

```sql
SELECT * FROM products WHERE 'electronics' MEMBER OF (tags);
```

## Collation and Type Casting Pitfalls
- **JSON type comparisons**: `JSON_EXTRACT` returns JSON type. Comparing directly to strings can be wrong for numbers/dates.

```sql
-- WRONG: lexicographic string comparison
WHERE data->>'$.price' <= '1200'

-- CORRECT: cast to numeric
WHERE CAST(data->>'$.price' AS UNSIGNED) <= 1200
```

- **Collation**: values extracted with `->>` behave like strings and use a collation. Use `COLLATE` when you need a specific comparison behavior.

```sql
WHERE data->>'$.status' COLLATE utf8mb4_0900_as_cs = 'Active'
```

## Common Pitfalls
- **Heavy update cost**: `JSON_SET`/`JSON_REPLACE` can touch large portions of a JSON document and generate significant redo/undo work on large blobs.
- **No partial indexes**: You can only index extracted scalar paths via generated columns.
- **Large documents hurt**: JSON stored inline in the row. Documents >8 KB spill to overflow pages, hurting read performance.
- **Type mismatches**: `JSON_EXTRACT` returns a JSON type. Comparing with `= 'foo'` may not match — use `->>` or `JSON_UNQUOTE`.
- **VIRTUAL vs STORED generated columns**: VIRTUAL columns compute on read (less storage, more CPU). STORED columns materialize on write (more storage, faster reads if selected often). Both can be indexed; for indexed paths, the index stores the computed value either way.

