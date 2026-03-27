---
title: Backup and Recovery
description: Logical/physical backups, PITR, WAL archiving, backup tools, and recovery strategies
tags: postgres, backup, recovery, pitr, pg_dump, pg_basebackup, wal-archiving, operations
---

# Backup and Recovery

**FUNDAMENTAL RULE: Backups are useless until you've successfully tested recovery.**

## Logical Backups (pg_dump)
Exports as SQL or custom format; portable across PG versions and architectures. Formats: `-Fp` (plain SQL), `-Fc` (custom compressed, selective restore), `-Fd` (directory, parallel with `-j`), `-Ft` (tar, avoid). Use `-Fd -j 4` for large DBs. Restore: `pg_restore -d dbname file.dump`; add `-j` for parallel restore. Selective table restore: `pg_restore -t tablename`. Slow for large DBs; RPO = backup frequency (typically 24h).

## Physical Backups (pg_basebackup)
Copies raw PGDATA; same major version and platform required; cross-architecture works if same endianness (e.g., x86_64 ↔ ARM64). Faster for large clusters; includes all databases. Flags: `-Ft -z -P` for compressed tar with progress. Manual alternative: `pg_backup_start()` → copy PGDATA → `pg_backup_stop()` (complex; must write returned `backup_label`).

## PITR (Point-in-Time Recovery)
Requires base backup + continuous WAL archiving. Restores to any timestamp, transaction, or named restore point. Without PITR: restore only to backup time (potentially lose hours). With PITR: RPO = minutes. `archive_command` must return 0 ONLY when file is safely stored—premature 0 = data loss risk. `wal_level` must be `replica` or `logical` (not `minimal`).

## WAL Archiving
`archive_mode=on`, `archive_command='test ! -f /archive/%f && cp %p /archive/%f'`. **Test archive command as postgres user** (not root) since permission issues are common. Monitor `pg_stat_archiver` for `failed_count`, `last_archived_time`. Archive failures prevent WAL recycling → disk fills.

## Tool Comparison
| Tool | Use case |
|------|----------|
| pg_dump | Small DBs, migrations, selective restore |
| pg_basebackup | Basic PITR, built-in |
| pgBackRest | Production—parallel, incremental, S3/GCS/Azure, retention |
| Barman | Enterprise PITR, retention policies |
| WAL-G | Cloud-native, S3/GCS/Azure |

## RPO/RTO
Logical only: RPO = backup interval (hours); RTO = hours. PITR: RPO = minutes; RTO = hours. Synchronous replication: RPO = 0; RTO = seconds to minutes (failover).

## Operational Rules
- Verify integrity with `pg_verifybackup` (PG 13+)
- Test recovery / PITR regularly
- Take backups from standby to avoid impacting primary
- Retention: 7 daily, 4 weekly, 12 monthly
- Monitor archive growth and backup age
- **Never assume backups work without testing**
