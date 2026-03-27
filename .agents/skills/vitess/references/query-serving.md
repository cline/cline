---
title: Query Serving and Routing
description: Query routing guide
tags: vitess, query-routing, mysql-compatibility, transactions, performance
---

# Query Serving and MySQL Compatibility

Vitess supports the MySQL protocol and nearly all MySQL syntax. Applications connect to VTGate as if it were a MySQL server, but distributed execution introduces important routing and compatibility differences.

Reference: https://vitess.io/docs/23.0/reference/compatibility/mysql-compatibility/

## Query routing

VTGate routes queries based on the VSchema and WHERE clause, targeting the fewest shards possible.

| Routing | Condition | Performance |
| --- | --- | --- |
| **Single-shard** | WHERE on primary vindex with `=` | Best |
| **Multi-shard (targeted)** | WHERE with `IN` on primary vindex | Good |
| **Scatter** | No primary vindex filter | Expensive (all shards) |
| **Unsharded** | Table in unsharded keyspace | Direct to single backend |

**Always include the primary vindex column in WHERE clauses** to avoid scatter queries. If a non-vindex column lookup is unavoidable, a **lookup vindex** exists as an option (see VSchema skill), but lookup vindexes are expensive. Prefer redesigning the schema or access patterns before reaching for a lookup vindex.

```sql
SELECT * FROM orders WHERE customer_id = 42;          -- single-shard (fast)
SELECT * FROM orders WHERE order_date > '2025-01-01'; -- scatter (slow)
```

Check routing with `VEXPLAIN PLAN`: look for Route variant `EqualUnique` (single-shard), `IN` (targeted multi-shard), or `Scatter` (all shards). For deeper debugging, `VEXPLAIN ALL` includes the MySQL query plans from each tablet, and `VEXPLAIN TRACE` includes metrics on how many rows are passed between parts of the query.

## Cross-shard operations

**Joins**: Cross-shard joins work but are expensive (nested loop joins). Co-locate tables by sharding on the same column so joins stay single-shard.

**Aggregations**: `GROUP BY`, `ORDER BY`, `LIMIT`, and aggregates work across shards. When grouping on at least one sharding key, Vitess pushes aggregation down to MySQL, then aggregates the per-shard results—making queries fast since shards process different chunks in parallel.

**Ordering**: As with MySQL itself, queries without `ORDER BY` have no guaranteed order (MySQL typically returns rows in index order, but this is not contractual). In Vitess this is especially true since results come from multiple shards. Always use `ORDER BY` when order matters.

**Subqueries**: Non-correlated subqueries are supported. Correlated subqueries may fail cross-shard; rewrite as JOINs.

## Transactions

| Mode | Behavior |
| --- | --- |
| `SINGLE` | Reject transactions spanning multiple shards |
| `MULTI` (typical default) | Best-effort multi-shard; sequential commits, partial commits possible |
| `TWOPC` | Two-phase commit for atomic cross-shard writes |

Single-shard transactions are fully ACID and support all MySQL isolation levels. Multi-shard transactions also support all isolation levels, but the isolation level is always local to each individual shard. Design schemas to keep transactions within a single shard. Use 2PC when atomic cross-shard writes are required.

## MySQL compatibility

**Fully supported**: Standard DML, DDL (via Online DDL), all JOIN types, non-correlated subqueries, UNION, non-recursive CTEs, prepared statements, `LAST_INSERT_ID()`, most functions/operators, `mysql_native_password`/`caching_sha2_password`, TLS.

**Partially supported**: Views (experimental, read-only), stored procedures (`CALL` on unsharded or shard-targeted only), temporary tables (unsharded only), `LOAD DATA` (unsharded only), UDFs (with `--enable-udfs`), recursive CTEs (experimental), `GET_LOCK`/`RELEASE_LOCK` (with restrictions; routed to a single shard).

**Not supported**: `CREATE PROCEDURE`, triggers, events, `LOCK TABLES`, window functions, `CREATE DATABASE`/`DROP DATABASE`. Use application-level logic, external schedulers, or vtctldclient instead.

**Auto-increment**: MySQL `AUTO_INCREMENT` is per-shard and produces duplicates. Use **Vitess Sequences** (see VSchema skill).

**Foreign keys**: Limited in sharded keyspaces. Prefer application-level referential integrity.

## Workload modes

- **OLTP** (default): strict timeouts and row-count limits. Configure via `--queryserver-config-query-timeout` and `--queryserver-config-transaction-timeout`.
- **OLAP**: `SET workload = 'olap';` for relaxed limits on analytical queries.

Per-query timeout: `SET query_timeout_ms = 5000;`

Kill queries: `KILL <connection_id>;` or `KILL QUERY <connection_id>;`

## Reference tables

Reference: https://vitess.io/docs/23.0/reference/vreplication/reference_tables/

Reference tables are small, rarely-changing lookup tables (e.g. countries, currencies, product categories) that Vitess replicates to every shard via a `Materialize` VReplication workflow. The source of truth lives in an unsharded keyspace where all DMLs are executed.

Mark tables with `"type": "reference"` in the VSchema of both keyspaces (the target also needs a `"source"` field). SELECTs are then served locally per shard — no cross-shard lookup needed.

## Performance checklist

1. Include primary vindex in WHERE clauses for single-shard routing
2. Co-locate frequently joined tables with shared vindexes
3. Consider lookup vindexes as a last resort for secondary access patterns (they add write overhead)
4. Always use `ORDER BY` when order matters
5. Avoid `SELECT *`; use `LIMIT` on user-facing queries
6. Prefer cursor-based pagination over `OFFSET`
7. Rewrite correlated subqueries as JOINs
8. Keep transactions within a single shard
9. Use OLAP mode for analytical queries
10. Monitor with `VEXPLAIN PLAN` to verify query routing; use `VEXPLAIN ALL` for MySQL query plans and `VEXPLAIN TRACE` for row-flow metrics
11. Use reference tables for small, rarely-changing lookup tables to avoid cross-shard joins
