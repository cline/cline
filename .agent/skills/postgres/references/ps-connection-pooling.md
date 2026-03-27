---
title: PgBouncer Connection Pooling
description: Pooling setup guide
tags: postgres, pgbouncer, connection-pooling, performance, transactions
---

# Connection Pooling with PgBouncer

PlanetScale provides PgBouncer for connection pooling. Connect on port `6432` instead of `5432`.

## When to Use PgBouncer (Port 6432)

All OLTP application workloads: web apps, APIs, high-concurrency read/write operations.

## When to Use Direct Connections (Port 5432)

- Schema changes (DDL)
- Analytics, reporting, batch processing
- Session-specific features (temp tables, session variables)
- ETL, data streaming, `pg_dump`
- Long-running admin transactions

## PgBouncer Types

PlanetScale offers three PgBouncer options. All use port `6432`.

| Type | Runs On | Routes To | Key Trait |
| ---- | ------- | --------- | --------- |
| **Local** | Same node as primary | Primary only | Included with every database; no replica routing |
| **Dedicated Primary** | Separate node | Primary | Connections persist through resizes, upgrades, and most failovers |
| **Dedicated Replica** | Separate node | Replicas | Read-only traffic; supports AZ affinity for lower latency |

- **Local PgBouncer** — use same credentials as direct, just change port to `6432`. Always routes to primary regardless of username.
- **Dedicated Primary** — runs off-server for improved HA. Use for production OLTP write traffic.
- **Dedicated Replica** — runs off-server for read-heavy workloads. Supports AZ affinity to prefer same-zone replicas. Multiple can be created for capacity or per-app isolation.

To connect to a dedicated PgBouncer, append `|pgbouncer-name` to the username (e.g., `postgres.xxx|write-pool` or `postgres.xxx|read-bouncer`).

## Transaction Pooling Limitations

PlanetScale PgBouncer uses **transaction pooling mode**. These features are unavailable:

- Prepared statements that persist across transactions
- Temporary tables
- `LISTEN`/`NOTIFY`
- Session-level advisory locks
- `SET` commands persisting beyond a transaction

## Recommended Patterns

- Size pools from observed concurrency, query memory behavior, and connection limits.
- Keep pooled app traffic on `6432` and reserve direct connections for DDL/admin/long-running jobs.

## Avoid Patterns

- Avoid setting pool size with only `CPU_cores * N` while ignoring query-memory amplification.
- Avoid running session-dependent workflows through transaction pooling.

## Connecting

```bash
# Local PgBouncer (same credentials, port 6432)
psql 'host=xxx.horizon.psdb.cloud port=6432 user=postgres.xxx password=pscale_pw_xxx dbname=mydb sslnegotiation=direct sslmode=verify-full sslrootcert=system'

# Dedicated primary PgBouncer (append |pgbouncer-name to user)
psql 'host=xxx.horizon.psdb.cloud port=6432 user=postgres.xxx|write-pool password=pscale_pw_xxx dbname=mydb sslnegotiation=direct sslmode=verify-full sslrootcert=system'

# Dedicated replica PgBouncer (append |pgbouncer-name to user)
psql 'host=xxx.horizon.psdb.cloud port=6432 user=postgres.xxx|read-bouncer password=pscale_pw_xxx dbname=mydb sslnegotiation=direct sslmode=verify-full sslrootcert=system'
```

Docs: https://planetscale.com/docs/postgres/connecting/pgbouncer
