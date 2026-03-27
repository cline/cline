---
title: PlanetScale CLI Reference
description: CLI command guide
tags: planetscale, cli, branches, deploy-requests, authentication
---

# pscale CLI Commands

Full CLI reference: https://planetscale.com/docs/cli. Use `pscale <command> --help` for subcommands and flags.

## Authentication

```bash
pscale auth login                    # Opens browser
pscale auth logout
pscale org list
pscale org switch <name>
```

### Service Token (CI/CD)

```bash
# Create and configure
pscale service-token create
pscale service-token add-access <id> read_branch --database <db>
# Use in CI/CD
export PLANETSCALE_SERVICE_TOKEN_ID="<id>"
export PLANETSCALE_SERVICE_TOKEN="<token>"
```

## Core Commands

```bash
# Databases
pscale database list
pscale database create <name>

# Branches
pscale branch list <db>
pscale branch create <db> <branch> [--from <parent>]
pscale branch delete <db> <branch>    # DESTRUCTIVE — always confirm with a human first
pscale branch schema <db> <branch>

# Deploy requests (schema changes) — Vitess only
pscale deploy-request create <db> <branch>
pscale deploy-request list <db>
pscale deploy-request deploy <db> <number>

# Connect
pscale shell <db> <branch>           # Opens psql (Postgres) or mysql (Vitess)
pscale connect <db> <branch>         # Proxy for GUI tools (secure tunnel) — Vitess only

# Credentials
pscale role create <db> <branch> <name>      # Postgres
pscale password create <db> <branch> <name>  # Vitess

# Other
pscale ping              # Check latency to regions
pscale region list       # Available regions
pscale backup list <db> <branch>
pscale backup create <db> <branch>
```

## Useful Flags

```bash
--format json    # Output as JSON (also: csv, human)
--org <name>     # Specify organization
--debug          # Debug output
```

For API calls via CLI, see [ps-cli-api-insights.md](ps-cli-api-insights.md).
