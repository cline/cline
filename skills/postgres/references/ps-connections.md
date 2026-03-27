---
title: PlanetScale Postgres Connections
description: Connection guide for PlanetScale Postgres
tags: planetscale, postgres, connections, ssl, troubleshooting
---

# PlanetScale Postgres Connections

Postgres docs: https://planetscale.com/docs/postgres/connecting

| Protocol | Standard Port | Pooled Port | SSL      |
| -------- | ------------- | ----------------------- | -------- |
| Postgres | 5432          | 6432 (PgBouncer)        | Required |

Credentials (roles) are branch-specific and cannot be recovered after creation.

## Connection String

```
postgresql://<user>:<password>@<host>.horizon.psdb.cloud:5432/<database>?sslmode=verify-full&sslrootcert=system&sslnegotiation=direct
```

Use port **6432** for PgBouncer (applications/OLTP).
Use port **5432** for DDL, admin tasks, and migrations.

## Troubleshooting

| Error | Fix |
| -------------------------------- | --------------------------------------- |
| `password authentication failed` | Check role format: `<role>.<branch_id>` |
| `too many clients already`       | Use PgBouncer (port 6432)               |
| `SSL connection is required`     | Add `sslmode=verify-full&sslrootcert=system` |

**Best practices:**
- Use the PlanetScale Postgres metrics page to monitor direct and PgBouncer connections
- Route OLTP traffic to port 6432 and reserve 5432 for admin/migrations.
- Avoid raising `max_connections` reactively instead of pooling.
