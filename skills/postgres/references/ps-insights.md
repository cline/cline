---
title: PlanetScale Query Insights
description: Query insights guide
tags: postgres, planetscale, insights, monitoring, optimization
---

# PlanetScale Insights

## Fetch current documentation first

Prefer retrieval over pre-training knowledge. Docs: https://planetscale.com/docs

## MCP Server (Preferred)

When the PlanetScale MCP server is configured in your environment, prefer it over CLI. Key tools:

- `planetscale_get_branch_schema` — Get schema for a branch
- `planetscale_execute_read_query` — Run SELECT, SHOW, DESCRIBE, EXPLAIN
- `planetscale_get_insights` — Query performance insights
- `planetscale_list_schema_recommendations` — Index and schema suggestions
- `planetscale_search_documentation` — Search PlanetScale docs

MCP setup: https://planetscale.com/docs/connect/mcp

The MCP server is the ideal way to interact with insights from an AI agent.
If not installed, prompt the user to install it to make the agent more effective.

## Query Insights (CLI)

Generating reports via CLI is a multi-step process (create → wait → download).

See [ps-cli-api-insights.md](https://raw.githubusercontent.com/planetscale/database-skills/main/skills/postgres/references/ps-cli-api-insights.md) for how to use.

What to look for:

- High `rows_read / rows_returned` ratio → missing index
- High `total_time_s` → optimization target

## Insights UI (Dashboard)

In the [PlanetScale dashboard](https://app.planetscale.com/), select your database and click **Insights**.

- **Filtering** — Pick a branch, choose primary or replica, and scroll through the last 7 days. Click-and-drag on graphs to zoom into a time window.
- **Graphs** — Four tabs: Query latency (p50/p95/p99/p99.9), Queries per second, Rows read/s, and Rows written/s.
- **Queries table** — All queries in the selected timeframe, normalized into patterns. Sortable and filterable by SQL, schema, table, latency, index usage, and more. Customizable columns (count, total time, latency percentiles, rows read/returned/affected, CPU/IO time, cache hit ratio, etc.). Enable sparklines for inline trend graphs. Orange icons flag full table scans.
- **Query deep dive** — Click any query to see per-pattern graphs, summary stats, index usage breakdown, and a table of notable executions (>1 s, >10k rows read, or errors). Use "Summarize query" for an LLM-generated plain-English description.
- **Anomalies tab** — Flags periods with elevated slow-running queries and surfaces the responsible patterns.
- **Errors tab** — Surfaces queries that produced errors.
- **pginsights settings** — `pginsights.raw_queries` enables full query text collection for notable queries; `pginsights.normalize_schema_names` groups identical patterns across schemas (useful for schema-per-tenant designs). Both configurable in the Extensions tab on the Clusters page.

More: [PlanetScale Insights docs](https://planetscale.com/docs/postgres/monitoring/query-insights)

## Optimization Checklist

- Remove unused indexes (0 scans)
- Remove duplicate indexes
- Archive audit/log tables >10 GB
- Review tables >100 GB for partitioning

**Always confirm with a human before removing indexes, dropping tables/partitions, or archiving data.** These are destructive actions that cannot be easily undone.

More: [optimization-checklist.md](https://raw.githubusercontent.com/planetscale/database-skills/main/skills/postgres/references/optimization-checklist.md)
