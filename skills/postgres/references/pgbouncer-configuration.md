---
title: PgBouncer Configuration
description: Pool sizing and connection limits
tags: postgres, pgbouncer, connection-pooling, configuration
---

# PgBouncer Configuration

## default_pool_size

Server connections per user/database pair. **Default: 20**

**Multiplication:** 2 users × 3 databases = `6 × default_pool_size` connections  
**Example:** 45 with 2 users and 3 databases = 270 backend connections

**Recommended values:**
- 1 or few database/user pairs OLTP: `25-50`
- High # of database/user pairs active simultaneously: `10-25`

## max_user_connections

Max backend connections per user across all databases. Set in `[users]` section. **Default: 0 (unlimited)**

**Recommended:** `0.7-0.85 × Postgres max_connections` to leave headroom for direct access.

## Postgres max_connections

Max concurrent connections to Postgres. **Default: 100**. Setting requires restart.

**Formula:** `max_connections ≥ (all PgBouncer pools) + anticipated steady-state direct connections + 20% buffer`

View: `SHOW max_connections;`

## Examples

Single database/user: `default_pool_size = 45, max_user_connections = 0`

Multiple users/databases: `default_pool_size = 25, max_user_connections = 150, postgres max_connections = 200`

## Monitoring

```sql
SELECT datname, usename, COUNT(*) FROM pg_stat_activity WHERE backend_type = 'client backend' GROUP BY datname, usename;
```

