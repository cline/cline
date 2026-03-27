---
title: Vitess Architecture Overview
description: Architecture guide
tags: vitess, architecture, vtgate, vttablet, topology, vtorc
---

# Vitess Architecture

Vitess is a database clustering system for horizontal scaling of MySQL. Applications connect to **VTGate** (stateless MySQL-protocol proxy), which routes queries through **VTTablet** (sidecar alongside each mysqld) based on metadata in the **Topology Service**.

Reference: https://vitess.io/docs/23.0/overview/architecture/

## VTGate

Stateless proxy. Load-balance across multiple instances. Handles:
- **Query routing**: parses SQL, consults VSchema, routes to correct shard(s)
- **Cross-shard execution**: scatter-gather, joins, aggregations, ORDER BY/LIMIT merging
- **Transaction management**: single-shard (full ACID) and multi-shard transactions (atomic distributed transactions via 2PC, production-ready in v22+)
- **Query buffering**: buffers queries during PlannedReparentShard failovers and MoveTables/Reshard traffic switches

Shard targeting: `USE 'keyspace:-80';` or `USE 'keyspace:80-@replica';`

OLTP (default, strict timeouts) vs OLAP mode: `SET workload = 'olap';`

## VTTablet

Sidecar process alongside each mysqld. A VTTablet + mysqld pair = a **tablet**.

Handles connection pooling (multiplexes many client connections to fewer MySQL backend connections), query rewriting, health reporting, Online DDL execution, throttling (based on replication lag), backup/restore, and resharding operations.

### Tablet types

A tablet in the database cluster can take any one of the following roles at a time:

| Type | Role | Notes |
| --- | --- | --- |
| `primary` | MySQL primary for shard | Reads and writes |
| `replica` | MySQL replica, promotable | Live user-facing reads |
| `rdonly` | MySQL replica, not promotable | Analytics, backups, background jobs |
| `backup` | Taking a consistent backup | Returns to previous type after |
| `restore` | Restoring from backup | Becomes replica/rdonly |
| `drained` | Taken out of use | e.g. tablet with errant GTIDs |

VTGate uses health checks (replication lag, serving state) to route to healthy, low-lag tablets.

## Topology Service

Metadata store (etcd recommended) with two tiers:
1. **Global topology**: keyspaces, shards, VSchemas, cells, routing rules (single instance for cluster)
2. **Cell-local topology**: tablet metadata, health (per data center/AZ; cell outage doesn't affect others)

A **cell** is a collocated group of servers (DC or AZ). VTGate serves reads from the local cell; cross-cell traffic includes writes to the primary (when it resides in another cell), VReplication streams, and global topo reads.

## vtctld and vtctldclient

Cluster management server and CLI. Key commands:

| Command | Purpose |
| --- | --- |
| `ApplySchema` / `ApplyVSchema` | Execute DDL / update VSchema |
| `GetVSchema` / `GetTablets` | View VSchema / list tablets |
| `PlannedReparentShard` | Graceful primary promotion |
| `EmergencyReparentShard` | Force-promote during outage |
| `MoveTables` / `Reshard` | Data migration workflows |
| `VDiff` / `Backup` | Verify consistency / take backup |

## VTOrc

Automatic failover manager. Detects primary failure, promotes best replica, re-points other replicas. Supports planned reparenting, emergency reparenting, and fully automatic promotion.

## Query lifecycle

1. Client sends MySQL query to VTGate
2. VTGate parses SQL → consults VSchema → generates execution plan
3. Routes to VTTablet(s) → VTTablet forwards to mysqld
4. Results flow back; VTGate merges multi-shard results (sort, aggregate, limit)

**Execution plan types** (check with `VEXPLAIN PLAN`; shown as `Route` operator `Variant` values). For deeper debugging, `VEXPLAIN ALL` includes the MySQL query plans from each tablet, and `VEXPLAIN TRACE` includes metrics on how many rows are passed between parts of the query. Route variants as of v22+:

| Route Variant | Meaning |
| --- | --- |
| `Unsharded` | Unsharded keyspace, single backend |
| `Local` | Single shard via primary vindex equality (e.g. `=` or `EqualUnique`) |
| `MultiShard` | Targeted multi-shard (e.g. `IN` list on primary vindex) |
| `Scatter` | All shards (expensive, avoid in hot paths) |
| `Passthrough` | Query passed directly to a specific tablet |
| `Complex` | Multi-part plan that doesn't fit simpler categories |
| `DirectDDL` | DDL statement routed directly |
| `ForeignKey` | Query involving foreign key handling |
| `Transaction` | Transaction-related routing |

## Best practices

- **Run multiple VTGate instances** behind a load balancer for high availability; any VTGate can serve any request since they are stateless
- **Use replica tablets** for read-heavy workloads to offload the primary; use rdonly tablets for backups and heavy analytics to avoid impacting live traffic
- **Monitor replication lag** and set alerts, since VTGate uses lag to decide which tablets are healthy enough to receive queries
- **Deploy VTOrc** in production for automatic primary failover and replication topology repair
- **Keep topology servers highly available** (3+ node etcd cluster) as they are the source of truth for all cluster metadata
