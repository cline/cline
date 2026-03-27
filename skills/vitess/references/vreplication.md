---
title: VReplication Workflows
description: Data migration guide
tags: vitess, vreplication, movetables, reshard, materialize, vdiff
---

# VReplication

VReplication is Vitess's core data movement engine. It streams binlog events from source to target in near-real-time, powering MoveTables, Reshard, Materialize, and Online DDL.

Reference: https://vitess.io/docs/23.0/reference/vreplication/

## MoveTables

Moves tables between keyspaces without downtime. Use for vertical sharding, migrating into Vitess, or changing sharding keys.

**Lifecycle**: `create → [copy] → [replicate] → switchtraffic → complete`

```bash
# Create workflow
vtctldclient MoveTables --workflow mv1 --target-keyspace customer \
  create --source-keyspace commerce --tables "customer,orders"

# Monitor, verify, switch, complete
vtctldclient MoveTables --workflow mv1 --target-keyspace customer status
vtctldclient VDiff --workflow mv1 --target-keyspace customer create
vtctldclient MoveTables --workflow mv1 --target-keyspace customer switchtraffic
vtctldclient MoveTables --workflow mv1 --target-keyspace customer complete
```

Key flags: `--on-ddl` (IGNORE|STOP|EXEC|EXEC_IGNORE), `--defer-secondary-keys` (faster copy for large tables), `--enable-reverse-replication` (true by default, enables rollback), `--sharded-auto-increment-handling=replace` (for unsharded→sharded moves).

**Rollback**: `reversetraffic` (after switch) or `cancel` (before switch).

## Reshard

Splits or merges shards horizontally. Same lifecycle as MoveTables.

```bash
# Split 2 shards into 4
vtctldclient Reshard --workflow rs1 --target-keyspace customer \
  create --source-shards "-80,80-" --target-shards "-40,40-80,80-c0,c0-"

vtctldclient VDiff --workflow rs1 --target-keyspace customer create
vtctldclient Reshard --workflow rs1 --target-keyspace customer switchtraffic
vtctldclient Reshard --workflow rs1 --target-keyspace customer complete
```

**Shard naming**: hex key ranges. `-80` = first half, `80-` = second half, `-` = entire range (unsharded).

## Materialize

Creates continuously-updated materialized views, optionally across keyspaces with transformations.

```bash
vtctldclient Materialize --workflow mat1 --target-keyspace reporting \
  create --source-keyspace commerce --table-settings '[{
    "target_table": "sales_summary",
    "source_expression": "SELECT region, SUM(total) as total_sales FROM orders GROUP BY region",
    "create_ddl": "CREATE TABLE sales_summary (region VARCHAR(64), total_sales DECIMAL(10,2), PRIMARY KEY (region))"
  }]'
```

## VDiff

Verifies data consistency between source and target. Reports matching, missing, extra, and mismatched rows. **Always run VDiff before `switchtraffic` in production.**

```bash
vtctldclient VDiff --workflow mv1 --target-keyspace customer create
vtctldclient VDiff --workflow mv1 --target-keyspace customer show last
```

### VStream

VStream is the underlying streaming API that powers all VReplication workflows above. It also provides change data capture (CDC) via VTGate gRPC API, streaming binlog events across all shards in a keyspace. Supports GTID-based positioning, table filtering, and resumable streams. Each event contains table name, operation (INSERT/UPDATE/DELETE), and row data.

## Traffic switching

Both MoveTables and Reshard support granular traffic switching:
1. Switch read traffic first (replica/rdonly) to verify correctness
2. Switch write traffic (brief write pause during cutover)
3. Roll back with `reversetraffic` if issues arise

VTGate buffers queries during switches to minimize application impact.

Key flags for `switchtraffic`: `--timeout` (max wait for replication catch-up, default 30s), `--max-replication-lag-allowed`, `--dry-run`.

## Best practices

Always run VDiff before switching traffic. Use `--defer-secondary-keys` for large tables. Switch reads first, then writes. Keep reverse replication enabled for rollback. Monitor VReplication lag. Use `--on-ddl=STOP` in production.
