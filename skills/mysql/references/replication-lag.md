---
title: Replication Lag Awareness
description: Read-replica consistency pitfalls and mitigations
tags: mysql, replication, lag, read-replicas, consistency, gtid
---

# Replication Lag

MySQL replication is asynchronous by default. Reads from a replica may return stale data.

## The Core Problem
1. App writes to primary: `INSERT INTO orders ...`
2. App immediately reads from replica: `SELECT * FROM orders WHERE id = ?`
3. Replica hasn't applied the write yet — returns empty or stale data.

## Detecting Lag
```sql
-- On the replica
SHOW REPLICA STATUS\G
-- Key field: Seconds_Behind_Source (0 = caught up, NULL = not replicating)
```
**Warning**: `Seconds_Behind_Source` measures relay-log lag, not true wall-clock staleness. It can underreport during long-running transactions because it only updates when transactions commit.

**GTID-based lag**: for more accurate tracking, compare `@@global.gtid_executed` (replica) to primary GTID position, or use `WAIT_FOR_EXECUTED_GTID_SET()` to wait for a specific transaction.

**Note**: parallel replication with `replica_parallel_type=LOGICAL_CLOCK` requires `binlog_format=ROW`. Statement-based replication (`binlog_format=STATEMENT`) is more limited for parallel apply.

## Mitigation Strategies

| Strategy | How | Trade-off |
|---|---|---|
| **Read from primary** | Route critical reads to primary after writes | Increases primary load |
| **Sticky sessions** | Pin user to primary for N seconds after a write | Adds session affinity complexity |
| **GTID wait** | `SELECT WAIT_FOR_EXECUTED_GTID_SET('gtid', timeout)` on replica | Adds latency equal to lag |
| **Semi-sync replication** | Primary waits for >=1 replica ACK before committing | Higher write latency |

## Common Pitfalls
- **Large transactions cause lag spikes**: A single `INSERT ... SELECT` of 1M rows replays as one big transaction on the replica. Break into batches.
- **DDL blocks replication**: `ALTER TABLE` with `ALGORITHM=COPY` on primary replays on replica, blocking other relay-log events during execution. `INSTANT` and `INPLACE` DDL are less blocking but still require brief metadata locks.
- **Long queries on replica**: A slow `SELECT` on the replica can block relay-log application. Use `replica_parallel_workers` (8.0+) with `replica_parallel_type=LOGICAL_CLOCK` for parallel apply. Note: LOGICAL_CLOCK requires `binlog_format=ROW` and `slave_preserve_commit_order=ON` (or `replica_preserve_commit_order=ON`) to preserve commit order.
- **IO thread bottlenecks**: Network latency, disk I/O, or `relay_log_space_limit` exhaustion can cause lag even when the SQL apply thread isn't saturated. Monitor `Relay_Log_Space` and connectivity.

## Guidelines
- Assume replicas are always slightly behind. Design reads accordingly.
- Use GTID-based replication for reliable failover and lag tracking.
- Monitor `Seconds_Behind_Source` with alerting (>5s warrants investigation).
