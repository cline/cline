---
title: Vitess Schema Changes
description: Online DDL guide
tags: vitess, schema-changes, online-ddl, migrations, ddl-strategy
---

# Schema Changes in Vitess

Vitess provides managed, online schema changes (Online DDL) that are non-blocking, trackable, cancellable, revertible, and failover-safe. This is the recommended approach for all production schema changes.

Reference: https://vitess.io/docs/23.0/user-guides/schema-changes/

## DDL strategies

Set via VTGate flag `--ddl-strategy`, session `SET @@ddl_strategy`, or vtctldclient `--ddl-strategy`.

| Strategy | Description |
| --- | --- |
| `vitess` (recommended) | VReplication-based. Non-blocking, revertible, failover-safe. |
| `online` | Alias for `vitess` |
| `mysql` | Managed by Vitess scheduler, DDL executed natively by MySQL. Blocking depends on query. |
| `direct` | Unmanaged. Direct DDL applied to MySQL. Not trackable. |

**Strategy flags** (append to strategy string):

```sql
SET @@ddl_strategy = 'vitess --postpone-completion --allow-concurrent';
```

Key flags: `--postpone-launch` (queue but don't start), `--postpone-completion` (run but don't cut over), `--allow-concurrent`, `--declarative` (supply desired CREATE TABLE, Vitess computes diff), `--singleton`, `--prefer-instant-ddl` (use MySQL INSTANT DDL when possible).

## Executing schema changes

```sql
SET @@ddl_strategy = 'vitess';
ALTER TABLE demo MODIFY id BIGINT UNSIGNED;  -- returns migration UUID
```

```bash
vtctldclient ApplySchema --ddl-strategy "vitess" \
  --sql "ALTER TABLE demo MODIFY id BIGINT UNSIGNED" commerce
```

Online DDL supports: `ALTER TABLE` (non-blocking via VReplication), `CREATE TABLE`, `DROP TABLE` (renamed then garbage-collected after 24h), `CREATE/ALTER/DROP VIEW`. Unsupported DDL (`RENAME`, `TRUNCATE`, `OPTIMIZE`) runs directly on MySQL.

## Migration lifecycle

```
queued → ready → running → complete
                        ↘ failed
         ↘ cancelled
```

## Monitoring and controlling migrations

```sql
SHOW VITESS_MIGRATIONS;                                              -- all migrations
SHOW VITESS_MIGRATIONS LIKE 'bf4598ab_8d55_11eb_815f_f875a4d24e90'; -- specific
```

Key columns: `uuid`, `migration_status`, `progress`, `started_timestamp`, `completed_timestamp`, `message`.

**Control commands**:

```sql
ALTER VITESS_MIGRATION '<uuid>' CANCEL;    -- cancel pending migration
ALTER VITESS_MIGRATION '<uuid>' RETRY;     -- retry failed migration
ALTER VITESS_MIGRATION '<uuid>' COMPLETE;  -- complete a postponed migration
ALTER VITESS_MIGRATION '<uuid>' LAUNCH;    -- launch a postponed migration
REVERT VITESS_MIGRATION '<uuid>';          -- revert last completed migration on table
```

## Declarative migrations

Supply desired CREATE TABLE; Vitess computes the ALTER:

```sql
SET @@ddl_strategy = 'vitess --declarative';
CREATE TABLE demo (id BIGINT UNSIGNED NOT NULL, status VARCHAR(32), PRIMARY KEY (id));
```

## Throttling and failover

- The **tablet throttler** auto-slows migrations when replication lag is high. Enable: `vtctldclient UpdateThrottlerConfig --enable <keyspace>`
- VReplication-based migrations auto-resume after planned/emergency reparenting (new primary must be available within 10 min)

## Best practices

1. Always use `vitess` strategy for production migrations
2. Use `--postpone-completion` for critical migrations to control cut-over timing
3. Monitor with `SHOW VITESS_MIGRATIONS` before and after
4. Enable the tablet throttler to prevent replication lag
5. Use declarative migrations for desired-state schema management
6. Avoid direct DDL in production (blocks writes and replication)
