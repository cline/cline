---
title: Storage Layout and Tablespaces
description: PGDATA directory structure, TOAST, fillfactor, tablespaces, and disk management
tags: postgres, storage, pgdata, toast, fillfactor, tablespaces, disk, operations
---

# Storage Layout and Tablespaces

## PGDATA Structure

- **base/** — database files (one subdirectory per database, named by OID)
- **global/** — cluster-wide shared catalogs (pg_database, pg_authid, pg_tablespace)
- **pg_wal/** — WAL files
- **pg_xact/** — transaction commit status

"Cluster" in PostgreSQL = single instance with one PGDATA, not an HA cluster. Each table/index = one or more files, split into 1GB segments. Tables have companion **_fsm** (free space map) and **_vm** (visibility map); indexes have **_fsm** only (no _vm), except hash indexes.

## Visibility Map and Free Space Map

- **_vm** tracks all-visible pages — VACUUM skips these
- **_fsm** tracks free space per page — INSERT uses this to find pages with room
- Both are small files but critical for performance

## TOAST

TOAST triggers when a **row** exceeds ~2KB. Large values are compressed and/or moved out-of-line to `pg_toast.pg_toast_<oid>` tables. **Strategies:** PLAIN (no TOAST), EXTENDED (compress+out-of-line, default for text/bytea), EXTERNAL (out-of-line, no compression — use for pre-compressed data), MAIN (compress, avoid out-of-line). TOAST tables bloat like regular tables — they need VACUUM. `SELECT *` fetches all TOAST columns; always SELECT only needed columns. Move large rarely-accessed columns to separate tables.

## Fillfactor

Controls how full pages are packed (default 100%). Lower fillfactor (70–80%) leaves room for HOT (Heap-Only Tuple) updates, which avoid index entries and reduce bloat on UPDATE-heavy tables. Keep 100% for insert-only or read-mostly tables. `ALTER TABLE t SET (fillfactor = 70);`

## Tablespaces

`pg_default` (base/), `pg_global` (global/) are built-in. Custom tablespaces: symbolic links in **pg_tblspc/** to other filesystem locations. Use for separating hot data (SSD) from archives (HDD). Moving tablespaces requires exclusive lock on affected tables.

## Disk Monitoring

- `pg_database_size('dbname')`, `pg_total_relation_size('tablename')`, `pg_relation_size('tablename')`
- Monitor disk usage: >80% = at risk; >90% = critical (VACUUM may fail if disk capacity is insufficient)
- Check inode usage (`df -i`) — can run out even with free space
- `pg_wal/` suddenly large = check replication slots and archiving
