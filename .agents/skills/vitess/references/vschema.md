---
title: VSchema Design and Configuration
description: VSchema config guide
tags: vitess, vschema, vindexes, sharding, sequences, lookup-vindexes
---

# VSchema Design and Configuration

## Contents

- [VSchema structure](#vschema-structure)
- [Vindexes](#vindexes)
- [Lookup vindexes](#lookup-vindexes)
- [Sequences](#sequences)
- [Discovering existing VSchema](#discovering-existing-vschema)
- [Sharding guidelines](#sharding-guidelines)
- [Advanced properties](#advanced-properties)
- [Troubleshooting scatter queries](#troubleshooting-scatter-queries)

The VSchema (Vitess Schema) tells VTGate how to route queries. It defines how tables map to keyspaces/shards, which columns determine shard placement (vindexes), and how tables relate across shards.

Reference: https://vitess.io/docs/23.0/user-guides/vschema-guide/

## VSchema structure

```json
{ "sharded": true, "vindexes": { ... }, "tables": { ... } }
```

For unsharded keyspaces: `{ "tables": { "product": {}, "my_seq": { "type": "sequence" } } }`

## Vindexes

A **vindex** maps a column value to a keyspace ID (determines shard placement). Every sharded table needs a **Primary Vindex** which must be unique and is immutable after insert.

| Vindex Type | Use For |
| --- | --- |
| `xxhash` | Any column type (most common) |
| `unicode_loose_xxhash` | Text columns needing case-insensitive hashing |
| `binary_md5` | Any column type (MD5-based alternative) |

**Choosing a primary vindex column**: pick the column most used in high-QPS WHERE clauses, that enables join co-location (tables joined frequently should shard on the same column), keeps transactions single-shard, and has high cardinality for even distribution.

### Example

```json
{
  "sharded": true,
  "vindexes": { "xxhash": { "type": "xxhash" } },
  "tables": {
    "customer": { "column_vindexes": [{ "column": "customer_id", "name": "xxhash" }] },
    "orders":   { "column_vindexes": [{ "column": "customer_id", "name": "xxhash" }] }
  }
}
```

Both tables shard on `customer_id` (**shared vindex**), so rows with the same `customer_id` land on the same shard, enabling single-shard joins and transactions.

## Lookup vindexes

Provide secondary routing to avoid scatter queries on non-primary-vindex columns. Backed by a separate lookup table mapping column values to keyspace IDs. **Lookup vindexes are expensive** — consider schema redesign or alternative access patterns before using.

```json
"customer_email_lookup": {
  "type": "consistent_lookup",
  "params": { "table": "product.customer_email_lookup", "from": "email", "to": "keyspace_id" },
  "owner": "customer"
}
```

Use `consistent_lookup` (or `consistent_lookup_unique` if strictly needed, though database-level uniqueness enforcement is a scalability anti-pattern). The `owner` table maintains the lookup. Backfill existing data with `vtctldclient LookupVindex create ...` (see `vtctldclient LookupVindex --help` for required args).

## Sequences

Replace MySQL `AUTO_INCREMENT` for sharded tables (per-shard auto-increment produces duplicates). A sequence is a single-row table in an **unsharded** keyspace.

```sql
CREATE TABLE customer_seq (id BIGINT, next_id BIGINT, cache BIGINT, PRIMARY KEY (id)) COMMENT 'vitess_sequence';
INSERT INTO customer_seq (id, next_id, cache) VALUES (0, 1, 1000);
```

Register in unsharded VSchema: `{ "customer_seq": { "type": "sequence" } }`

Link to sharded table:
```json
"customer": {
  "column_vindexes": [{ "column": "customer_id", "name": "xxhash" }],
  "auto_increment": { "column": "customer_id", "sequence": "product.customer_seq" }
}
```

Sequence gaps from caching/restarts are expected and harmless.

## Discovering existing VSchema

Retrieve the current VSchema for a keyspace via CLI or SQL:

```bash
# Full VSchema JSON for a keyspace
vtctldclient GetVSchema <keyspace>

# List all vindexes defined in a keyspace
vtctldclient GetVSchema <keyspace> | jq '.vindexes'
```

```sql
-- From a VTGate MySQL session
SHOW VSCHEMA TABLES;           -- list tables known to the VSchema
SHOW VSCHEMA VINDEXES;         -- list vindexes and their types
SHOW CREATE TABLE <table>;     -- includes vindex column info in comments
```

Use `SHOW VSCHEMA TABLES` to quickly confirm whether a table is recognized by VTGate routing. Use `GetVSchema` for the full JSON when you need to inspect vindex params, sequences, or advanced properties.

## Sharding guidelines

Optimal shard size depends on hardware (CPUs, RAM, disk I/O) and workload characteristics — there is no universal number. Highest-QPS query's WHERE clause dictates primary vindex. Co-locate joined tables; keep transactions local. For multi-tenant apps, use multi-column vindexes. `MoveTables` can change sharding keys later.

## Advanced properties

`auto_increment` (link to sequence), `type: "reference"` (copied to all shards), `pinned` (pin to shard), `column_list_authoritative` (planner only trusts columns explicitly listed in VSchema).

## Troubleshooting scatter queries

Check: is WHERE filtering on primary vindex? Is a lookup vindex configured for that column? Use `VEXPLAIN PLAN` to see routing. For deeper performance debugging, use `VEXPLAIN ALL` to include MySQL query plans and `VEXPLAIN TRACE` to see metrics on how many rows are passed between parts of the query. Primary vindex column updates are blocked; use `MoveTables` to re-shard.
