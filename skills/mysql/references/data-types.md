---
title: MySQL Data Type Selection
description: Data type reference
tags: mysql, data-types, numeric, varchar, datetime, json
---

# Data Types

Choose the smallest correct type — more rows per page, better cache, faster queries.

## Numeric Sizes
| Type | Bytes | Unsigned Max |
|---|---|---|
| `TINYINT` | 1 | 255 |
| `SMALLINT` | 2 | 65,535 |
| `MEDIUMINT` | 3 | 16.7M |
| `INT` | 4 | 4.3B |
| `BIGINT` | 8 | 18.4 quintillion |

Use `BIGINT UNSIGNED` for PKs — `INT` exhausts at ~4.3B rows. Use `DECIMAL(19,4)` for money, never `FLOAT`.

## Strings
- `VARCHAR(N)` over `TEXT` when bounded — can be indexed directly.
- **`N` matters**: `VARCHAR(255)` vs `VARCHAR(50)` affects memory allocation for temp tables and sorts.

## TEXT/BLOB Indexing
- You generally can't index `TEXT`/`BLOB` fully; use prefix indexes: `INDEX(text_col(255))`.
- Prefix length limits depend on InnoDB row format:
  - DYNAMIC/COMPRESSED: 3072 bytes max (≈768 chars with utf8mb4)
  - REDUNDANT/COMPACT: 767 bytes max (≈191 chars with utf8mb4)
- For keyword search, consider `FULLTEXT` indexes instead of large prefix indexes.

## Date/Time
- `TIMESTAMP`: 4 bytes, auto-converts timezone, but **2038 limit**. Use `DATETIME` for dates beyond 2038.

```sql
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

## JSON
Use for truly dynamic data only. Index JSON values via generated columns:

```sql
ALTER TABLE products
  ADD COLUMN color VARCHAR(50) GENERATED ALWAYS AS (attributes->>'$.color') STORED,
  ADD INDEX idx_color (color);
```

Prefer simpler types like integers and strings over JSON.

## Generated Columns
Use generated columns for computed values, JSON extraction, or functional indexing:

```sql
-- VIRTUAL (default): computed on read, no storage
ALTER TABLE orders
  ADD COLUMN total_cents INT GENERATED ALWAYS AS (price_cents * quantity) VIRTUAL;

-- STORED: computed on write, can be indexed
ALTER TABLE products
  ADD COLUMN name_lower VARCHAR(255) GENERATED ALWAYS AS (LOWER(name)) STORED,
  ADD INDEX idx_name_lower (name_lower);
```

Choose **VIRTUAL** for simple expressions when space matters. Choose **STORED** when indexing is required or the expression is expensive.

## ENUM/SET
Prefer lookup tables — `ENUM`/`SET` changes require `ALTER TABLE`, which can be slow on large tables.
