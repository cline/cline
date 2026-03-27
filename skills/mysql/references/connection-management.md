---
title: Connection Pooling and Limits
description: Connection management best practices
tags: mysql, connections, pooling, max-connections, performance
---

# Connection Management

Every MySQL connection costs memory (~1–10 MB depending on buffers). Unbounded connections cause OOM or `Too many connections` errors.

## Sizing `max_connections`
Default is 151. Don't blindly raise it — more connections = more memory + more contention.

```sql
SHOW VARIABLES LIKE 'max_connections';         -- current limit
SHOW STATUS LIKE 'Max_used_connections';        -- high-water mark
SHOW STATUS LIKE 'Threads_connected';           -- current count
```

## Pool Sizing Formula
A good starting point for OLTP: **pool size = (CPU cores * N)** where N is typically 2-10. This is a baseline — tune based on:
- Query characteristics (I/O-bound queries may benefit from more connections)
- Actual connection usage patterns (monitor `Threads_connected` vs `Max_used_connections`)
- Application concurrency requirements

More connections beyond CPU-bound optimal add context-switch overhead without improving throughput.

## Timeout Tuning

### Idle Connection Timeouts
```sql
-- Kill idle connections after 5 minutes (default is 28800 seconds / 8 hours — way too long)
SET GLOBAL wait_timeout = 300;         -- Non-interactive connections (apps)
SET GLOBAL interactive_timeout = 300;  -- Interactive connections (CLI)
```

**Note**: These are server-side timeouts. The server closes idle connections after this period. Client-side connection timeouts (e.g., `connectTimeout` in JDBC) are separate and control connection establishment.

### Active Query Timeouts
```sql
-- Increase for bulk operations or large result sets (default: 30 seconds)
SET GLOBAL net_read_timeout = 60;      -- Time server waits for data from client
SET GLOBAL net_write_timeout = 60;     -- Time server waits to send data to client
```

These apply to active data transmission, not idle connections. Increase if you see errors like `Lost connection to MySQL server during query` during bulk inserts or large SELECTs.

## Thread Handling
MySQL uses a **one-thread-per-connection** model by default: each connection gets its own OS thread. This means `max_connections` directly impacts thread count and memory usage.

MySQL also caches threads for reuse. If connections fluctuate frequently, increase `thread_cache_size` to reduce thread creation overhead.

## Common Pitfalls
- **ORM default pools too large**: Rails default is 5 per process — 20 Puma workers = 100 connections from one app server. Multiply by app server count.
- **No pool at all**: PHP/CGI models open a new connection per request. Use persistent connections or ProxySQL.
- **Connection storms on deploy**: All app servers reconnect simultaneously when restarted, potentially exhausting `max_connections`. Mitigations: stagger deployments, use connection pool warm-up (gradually open connections), or use a proxy layer.
- **Idle transactions**: Connections with open transactions (`BEGIN` without `COMMIT`/`ROLLBACK`) are **not** closed by `wait_timeout` and hold locks. This causes deadlocks and connection leaks. Always commit or rollback promptly, and use application-level transaction timeouts.

## Prepared Statements
Use prepared statements with connection pooling for performance and safety:
- **Performance**: reduces repeated parsing for parameterized queries
- **Security**: helps prevent SQL injection

Note: prepared statements are typically connection-scoped; some pools/drivers provide statement caching.

## When to Use a Proxy
Use **ProxySQL** or **PlanetScale connection pooling** when: multiple app services share a DB, you need query routing (read/write split), or total connection demand exceeds safe `max_connections`.

## Vitess / PlanetScale Note
If running on **PlanetScale** (or Vitess), connection pooling is handled at the Vitess `vtgate` layer. This means your app can open many connections to vtgate without each one mapping 1:1 to a MySQL backend connection. Backend connection issues are minimized under this architecture.
