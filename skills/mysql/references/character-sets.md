---
title: Character Sets and Collations
description: Charset config guide
tags: mysql, character-sets, utf8mb4, collation, encoding
---

# Character Sets and Collations

## Always Use utf8mb4
MySQL's `utf8` = `utf8mb3` (3-byte only, no emoji/many CJK). Always `utf8mb4`.

```sql
CREATE DATABASE myapp DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

## Collation Quick Reference
| Collation | Behavior | Use for |
|---|---|---|
| `utf8mb4_0900_ai_ci` | Case-insensitive, accent-insensitive | Default |
| `utf8mb4_0900_as_cs` | Case/accent sensitive | Exact matching |
| `utf8mb4_bin` | Byte-by-byte comparison | Tokens, hashes |

`_0900_` = Unicode 9.0 (preferred over older `_unicode_` variants).

## Collation Behavior

Collations affect string comparisons, sorting (`ORDER BY`), and pattern matching (`LIKE`):

- **Case-insensitive (`_ci`)**: `'A' = 'a'` evaluates to true, `LIKE 'a%'` matches 'Apple'
- **Case-sensitive (`_cs`)**: `'A' = 'a'` evaluates to false, `LIKE 'a%'` matches only lowercase
- **Accent-insensitive (`_ai`)**: `'e' = 'é'` evaluates to true
- **Accent-sensitive (`_as`)**: `'e' = 'é'` evaluates to false
- **Binary (`_bin`)**: strict byte-by-byte comparison (most restrictive)

You can override collation per query:

```sql
SELECT * FROM users
WHERE name COLLATE utf8mb4_0900_as_cs = 'José';
```

## Migrating from utf8/utf8mb3

```sql
-- Find columns still using utf8
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'mydb' AND character_set_name = 'utf8';
-- Convert
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

**Warning**: index key length limits depend on InnoDB row format:
- DYNAMIC/COMPRESSED: 3072 bytes max (≈768 chars with utf8mb4)
- REDUNDANT/COMPACT: 767 bytes max (≈191 chars with utf8mb4)

`VARCHAR(255)` with utf8mb4 = up to 1020 bytes (4×255). That's safe for DYNAMIC/COMPRESSED but exceeds REDUNDANT/COMPACT limits.

## Connection
Ensure client uses `utf8mb4`: `SET NAMES utf8mb4;` (most modern drivers default to this).

`SET NAMES utf8mb4` sets three session variables:
- `character_set_client` (encoding for statements sent to server)
- `character_set_connection` (encoding for statement processing)
- `character_set_results` (encoding for results sent to client)

It also sets `collation_connection` to the default collation for utf8mb4.
