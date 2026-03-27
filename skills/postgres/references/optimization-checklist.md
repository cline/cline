---
title: Database Optimization Checklist
description: Optimize checklist
tags: postgres, optimization, indexes, partitioning, maintenance
---

# Optimization Checklist

When optimizing performance, check the following:

- Look for unused indexes (0 scans; exclude unique/primary indexes and verify stats age first)
- Look for duplicate indexes
- Archive audit/log tables >10GB
- Review tables >500GB for partitioning (>100GB for time-series/logs)
- Verify all extensions are supported
- Check for circular foreign key dependencies
- Consider alternatives to UUID primary keys for large tables
- Configure connection pooling for OLTP workloads
- **Always confirm with a human before removing any indexes, dropping partitions, archiving tables, or performing other destructive actions**
