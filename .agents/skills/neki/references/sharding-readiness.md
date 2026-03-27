---
name: pre-sharding-postgres
description: Guide schema design, query patterns, and data modeling decisions so a PostgreSQL database can be sharded in the future with minimal rework.
tags: postgres, sharding, schema-design, query-patterns, data-modeling
---

# Pre-Sharding PostgreSQL Best Practices

This guide helps prepare a Postgres schema for future horizontal sharding with minimal rework.

## Shard Key Design

Choose a **shard key** now, even if you're not sharding yet. It should be present on every tenant/user-scoped table, included in every frequent query's WHERE clause, high cardinality, and evenly distributed. Prefer an immutable key — changing it later requires data migration. Common choices: `tenant_id`, `org_id`, `user_id`, `account_id`.

Use real workload data to choose: favor a key that keeps your hottest queries single-shard.

**IDs:** UUIDs (or UUIDv7) work well for globally unique IDs without coordination; per-shard sequences are fine for the secondary column in composite primary keys.

## Primary Keys

A single-column PK is fine when it functions as the natural shard key (e.g., `user_id` on a `users` table). For other tables, use a composite PK with the shard key leading so lookups stay shard-local. Avoid globally-coordinated sequences across shards.

```sql
-- good: single-column PK that is the shard key
CREATE TABLE users (user_id BIGINT PRIMARY KEY, ...);

-- good: composite PK with shard key leading on a child table
CREATE TABLE orders (
  user_id BIGINT NOT NULL,
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (user_id, id)
);

-- incorrect: shard key not leading in composite PK
PRIMARY KEY (id, user_id)
```

## Co-located Data

Tables frequently joined must share the same shard key so joins stay shard-local. Always include the shard key in join conditions. Use consistent column types for the shard key across co-located tables (e.g., don't mix `int` and `bigint` for the same logical key).

```sql
-- correct: shard-local join
SELECT o.id, oi.product_id FROM orders o
JOIN order_items oi ON oi.tenant_id = o.tenant_id AND oi.order_id = o.id
WHERE o.tenant_id = $1;
```

## Reference Tables

Small, rarely-changing lookup tables (countries, currencies, feature flags) don't need a shard key — they get replicated across shards. Characteristics: typically small (e.g., well under 100K rows), rarely written, no tenant scoping, broadly joined.

## Query Patterns

Every query on sharded tables must include the shard key. Without it, the query becomes a scatter-gather across all shards.

```sql
-- correct: routed to single shard
SELECT * FROM orders WHERE tenant_id = $1 AND status = 'pending';

-- incorrect: hits all shards
SELECT * FROM orders WHERE status = 'pending';
```

For lookups by a non-shard column, maintain a mapping table. Ensure mapping consistency with backfill/repair jobs and miss-rate monitoring.

## Indexes

Lead indexes with the shard key. Scope unique constraints to include it.

```sql
-- correct
CREATE INDEX idx_orders_tenant_status ON orders (tenant_id, status, created_at);
ALTER TABLE orders ADD CONSTRAINT uq_order_number UNIQUE (tenant_id, order_number);

-- incorrect: index or unique constraint without shard key
CREATE INDEX idx_orders_status ON orders (status, created_at);
ALTER TABLE orders ADD CONSTRAINT uq_order_number UNIQUE (order_number);
```

## Foreign Keys

Cross-shard FKs are challenging to support in sharded systems. FKs within the same shard key (co-located data) may be supported depending on the sharding implementation. Cross-shard-key FKs must move to application-level enforcement before sharding. Some systems require all FKs to be disabled before sharding.

## Transactions

Keep transactions within a single shard key value. Cross-shard transactions typically require 2PC or similar distributed coordination and are significantly slower.

## Aggregations

Global aggregations (`COUNT(*)`, `SUM()` across all shards) become expensive. Scope aggregations to the shard key, or maintain pre-computed rollup tables for global stats.

## Denormalization

Propagate the shard key onto every related table, even if it feels redundant. A "redundant" `tenant_id` column avoids cross-shard joins.

## Shard-Readiness Checklist

1. Shard key identified and present on every tenant-scoped/sharded table (reference tables excluded)
2. Composite PKs with shard key leading; shard-safe IDs (no global coordination)
3. Shard key in all queries, indexes (leading position), and join conditions
4. Unique constraints scoped to include shard key
5. Cross-shard FKs audited; plan for app-level enforcement (or FK removal if required)
6. Transactions scoped to single shard key value
7. Global aggregations identified; rollup/async plan in place
8. Migrations avoid long locks; Use online / revertible patterns
9. Lookup/mapping paths hardened with backfill and monitoring
