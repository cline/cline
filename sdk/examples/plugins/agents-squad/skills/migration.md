---
name: migration
description: Plan and execute data or schema migrations — database, config, and API migrations with rollback strategies.
---

# Migration Skill

When planning or executing a migration (database schema, data transformation, config format, or API version), follow this process:

## 1. Assess Scope

- What is being migrated? (Schema, data, config, API contract)
- How much data is affected? (Row count, file count, consumer count)
- What is the downtime tolerance? (Zero-downtime, maintenance window, offline)
- What systems depend on the current state?

## 2. Plan the Migration

### Strategy Selection

- **Expand-Contract** (preferred for zero-downtime):
  1. Expand: Add new columns/fields/endpoints alongside old ones.
  2. Migrate: Backfill data, update consumers to use new format.
  3. Contract: Remove old columns/fields/endpoints.

- **Blue-Green**: Run old and new versions in parallel, switch traffic.
- **Big Bang**: Take the system offline, migrate, bring it back. Only for small datasets or when downtime is acceptable.

### Rollback Plan

Every migration must have a rollback plan before execution:
- Can the migration be reversed with a down migration?
- Is there a backup of the current state?
- What is the point of no return (if any)?
- How long does rollback take?

## 3. Write the Migration

### Database Migrations
- One migration file per logical change.
- Include both `up` and `down` functions.
- Use transactions where the database supports them.
- Never modify data and schema in the same migration.
- Test with production-scale data volumes (not just empty tables).

### Data Migrations
- Process in batches to avoid memory exhaustion and lock contention.
- Log progress (processed X of Y records).
- Handle partial failures: make migrations idempotent so they can be re-run.
- Validate data after migration (row counts, checksums, spot checks).

### Config Migrations
- Read old format, write new format, validate round-trip.
- Preserve comments and ordering where possible.
- Provide a CLI command or script users can run.

## 4. Test

- Run the migration on a copy of production data.
- Verify the application works correctly after migration.
- Run the rollback and verify the application works on the old state.
- Test the migration under load if zero-downtime is required.

## 5. Execute

- Take a backup before starting.
- Run the migration with monitoring (error rates, latency, disk usage).
- Verify success criteria immediately after completion.
- Keep the rollback plan ready for the agreed monitoring period.

## 6. Report

Document:
- What was migrated and why.
- Duration and any issues encountered.
- Verification results.
- Rollback status (available / expired / not needed).
