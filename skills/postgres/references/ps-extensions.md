---
title: PlanetScale PostgreSQL Extensions
description: Extension reference
tags: postgres, extensions
---

# PostgreSQL Extensions on PlanetScale

Only use PlanetScale-supported extensions. For the complete and up-to-date list of available extensions, see: https://planetscale.com/docs/postgres/extensions

Do not rely on hard-coded extension lists — always check the documentation above for current availability.

## Enabling Extensions

Some extensions must first be **enabled in the PlanetScale Dashboard** (Clusters > Extensions) before they can be created in SQL. This often requires a database restart.

Once enabled in the dashboard, create the extension in SQL:

```sql
CREATE EXTENSION IF NOT EXISTS <extension_name>;
```

## Recommended Patterns

- Always check the [PlanetScale extensions docs](https://planetscale.com/docs/postgres/extensions) before assuming an extension is available.
- Verify extension availability in PlanetScale configuration and docs before schema design depends on it.
- Enable `pg_stat_statements` early for baseline query telemetry.
