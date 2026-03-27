---
title: Primary Key Design
description: Primary key patterns
tags: mysql, primary-keys, auto-increment, uuid, innodb
---

# Primary Keys

InnoDB stores rows in primary key order (clustered index). This means:
- **Sequential keys = optimal inserts**: new rows append, minimizing page splits and fragmentation.
- **Random keys = fragmentation**: random inserts cause page splits to maintain PK order, wasting space and slowing inserts.
- **Secondary index lookups**: secondary indexes store the PK value and use it to fetch the full row from the clustered index.

## INT vs BIGINT for Primary Keys
- **INT UNSIGNED**: 4 bytes, max ~4.3B rows.
- **BIGINT UNSIGNED**: 8 bytes, max ~18.4 quintillion rows.

Guideline: default to **BIGINT UNSIGNED** unless you're certain the table will never approach the INT limit. The extra 4 bytes is usually cheaper than the risk of exhausting INT.

## Avoid Random UUID as Clustered PK
- UUID PK stored as `BINARY(16)`: 16 bytes (vs 8 for BIGINT). Random inserts cause page splits, and every secondary index entry carries the PK.
- UUID stored as `CHAR(36)`/`VARCHAR(36)`: 36 bytes (+ overhead) and is generally worse for storage and index size.
- If external identifiers are required, store UUID as `BINARY(16)` in a secondary unique column:

```sql
CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id BINARY(16) NOT NULL,
  UNIQUE KEY idx_public_id (public_id)
);
-- UUID_TO_BIN(uuid, 1) reorders UUIDv1 bytes to be roughly time-sorted (reduces fragmentation)
-- MySQL's UUID() returns UUIDv4 (random). For time-ordered IDs, use app-generated UUIDv7/ULID/Snowflake.
INSERT INTO users (public_id) VALUES (UUID_TO_BIN(?, 1)); -- app provides UUID string
```

If UUIDs are required, prefer time-ordered variants such as UUIDv7 (app-generated) to reduce index fragmentation.

## Secondary Indexes Include the Primary Key
InnoDB secondary indexes store the primary key value with each index entry. Implications:
- **Larger secondary indexes**: a secondary index entry includes (indexed columns + PK bytes).
- **Covering reads**: `SELECT id FROM users WHERE email = ?` can often be satisfied from `INDEX(email)` because `id` (PK) is already present in the index entry.
- **UUID penalty**: a `BINARY(16)` PK makes every secondary index entry 8 bytes larger than a BIGINT PK.

## Auto-Increment Considerations
- **Hot spot**: inserts target the end of the clustered index (usually fine; can bottleneck at extreme insert rates).
- **Gaps are normal**: rollbacks or failed inserts can leave gaps.
- **Locking**: auto-increment allocation can introduce contention under very high concurrency.

## Alternative Ordered IDs (Snowflake / ULID / UUIDv7)
If you need globally unique IDs generated outside the database:
- **Snowflake-style**: 64-bit integers (fits in BIGINT), time-ordered, compact.
- **ULID / UUIDv7**: 128-bit (store as `BINARY(16)`), time-ordered, better insert locality than random UUIDv4.

Recommendation: prefer `BIGINT AUTO_INCREMENT` unless you need distributed ID generation or externally meaningful identifiers.

## Replication Considerations
- Random-key insert patterns (UUIDv4) can amplify page splits and I/O on replicas too, increasing lag.
- Time-ordered IDs reduce fragmentation and tend to replicate more smoothly under heavy insert workloads.

## Composite Primary Keys

Use for join/many-to-many tables. Most-queried column first:

```sql
CREATE TABLE user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id)
);
```
