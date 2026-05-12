# Cline Automation Examples

This directory contains example automation specs for file-based and event-driven automation in Cline. Use these as templates to set up your own recurring or event-driven tasks.

## 🚀 Quick Start: Pick Your Automation

| Goal | Spec | Schedule | Mode |
|------|------|----------|------|
| 🔄 Review code | `daily-code-review` | Mon-Fri 9 AM | act |
| 📝 Update CHANGELOG | `changelog-generator` | Friday 6 PM | act |
| 🔒 Check security | `dependency-check` | Monday 10 AM | act |
| ✅ Verify tests | `test-coverage-report` | Daily 10 PM | act |
| ⚡ Track performance | `performance-baseline` | Daily 2 AM | act |
| 🏷️ Check types | `type-check-strict` | Daily 6 AM | plan |
| 🎨 Audit style | `code-style-audit` | Wednesday 3 AM | act |
| 🗑️ Find dead code | `dead-code-finder` | Sunday 4 AM | plan |
| 📚 Check docs | `documentation-check` | Thursday 5 AM | plan |
| 🎉 Weekly wins | `weekly-metrics-summary` | Friday 5 PM | act |
| 👀 Review PRs | `pr-review` | On PR opened | act |
| 📋 Check PR changelog | `pr-changelog-check` | On PR opened | act |
| 📊 PR coverage | `pr-test-coverage` | On PR updated | act |

## 📋 Overview

Cline automation supports two types of specs:

1. **Recurring specs** (`.cron.md`) — Run on a schedule
2. **Event-driven specs** (`.event.md`) — Run when an event occurs

Both can be enabled in `.cline/cron/` to be picked up by the hub or SDK.

## 🔄 Recurring Specs

### [`daily-code-review.cron.md`](./daily-code-review.cron.md)

A production-ready example that runs a code review automation on weekday mornings.

**Key fields:**
- `schedule: "0 9 * * MON-FRI"` — 9 AM on weekdays (cron format)
- `tools: run_commands,read_files` — Restrict tools to specific actions
- `mode: act` — Execute commands (vs. `plan` or `yolo`)
- `timeoutSeconds: 1800` — 30-minute timeout
- `modelSelection` — Override model/provider for this run
- `notesDirectory` — Durable automation notes for multi-run state

**Usage:**
```bash
mkdir -p ~/.cline/cron
cp examples/cron/daily-code-review.cron.md ~/.cline/cron/
# Edit the spec: set workspaceRoot, model, etc.
# Spec is reconciled on startup; next run enqueued automatically
```

**One-off specs:**
For one-time tasks, save as `.cline/cron/<name>.md` (no `.cron` infix) and omit the `schedule` field.

### Additional Recurring Spec Examples

#### [`changelog-generator.cron.md`](./changelog-generator.cron.md)

**Auto-generate changelog from recent commits**

Runs every Friday at 6 PM. Reviews commits in a directory (e.g., `apps/cli/`) and generates a changelog entry summarizing new features, bug fixes, and breaking changes. Updates `CHANGELOG.md` without bumping the version.

**Best for:** Projects with frequent releases and manual changelog maintenance overhead.

#### [`dependency-check.cron.md`](./dependency-check.cron.md)

**Weekly dependency health check**

Runs every Monday at 10 AM. Checks for outdated packages, security vulnerabilities, unused dependencies, and major version upgrades. Generates a prioritized report for action.

**Best for:** Teams that want proactive dependency maintenance without daily alerts.

#### [`test-coverage-report.cron.md`](./test-coverage-report.cron.md)

**Daily test coverage metrics**

Runs every day at 10 PM. Runs the full test suite, generates coverage reports, and identifies files needing more tests. Creates a markdown summary with visual indicators.

**Best for:** Maintaining code quality standards and tracking coverage trends over time.

#### [`performance-baseline.cron.md`](./performance-baseline.cron.md)

**Track performance metrics overnight**

Runs daily at 2 AM. Measures build time, bundle size, and cold start performance. Detects regressions and alerts if metrics exceed thresholds.

**Best for:** CLI tools, libraries, or services where performance is critical.

#### [`type-check-strict.cron.md`](./type-check-strict.cron.md)

**Strict TypeScript type checking**

Runs every morning at 6 AM in `plan` mode. Reports all type errors with strict compiler options and categorizes them by issue type.

**Best for:** Gradually improving type safety without blocking development.

#### [`code-style-audit.cron.md`](./code-style-audit.cron.md)

**Code style and linting audit**

Runs every Wednesday at 3 AM. Runs ESLint and Prettier, identifies unused code, detects anti-patterns, and provides a summary of violations.

**Best for:** Maintaining code consistency across a team.

#### [`dead-code-finder.cron.md`](./dead-code-finder.cron.md)

**Find and report dead code**

Runs every Sunday at 4 AM in `plan` mode. Identifies unused exports, unreachable code, and deprecated patterns. Prioritizes safe removals vs. ones requiring review.

**Best for:** Regular codebase cleanup and reducing technical debt.

#### [`documentation-check.cron.md`](./documentation-check.cron.md)

**Documentation coverage audit**

Runs every Thursday at 5 AM in `plan` mode. Analyzes documentation completeness, identifies missing JSDoc comments, checks for outdated docs, and evaluates overall documentation structure.

**Best for:** Improving code maintainability and onboarding of new team members.

#### [`weekly-metrics-summary.cron.md`](./weekly-metrics-summary.cron.md)

**Fun weekly metrics summary for the team** 🎉

Runs every Friday at 5 PM. Collects a week's worth of data: commits, test coverage, performance, PR activity, and contributor stats. Generates a celebratory markdown report with emojis, top contributors, metrics trends, and fun facts.

**Best for:** Team morale, tracking velocity, and celebrating wins. Great for Friday morning stand-ups or team channels.

## 🎯 Event-Driven Specs

Event-driven specs live in `.cline/cron/events/` and trigger when normalized events are ingested.

### [`events/pr-review.event.md`](./events/pr-review.event.md)

Runs a pull request review whenever a new PR opens on the `main` branch.

**Key fields:**
- `event: github.pull_request.opened` — Trigger on this event type
- `filters` — Narrow scope: match repository, branch, labels, etc.
- `debounceSeconds: 30` — Wait 30s for more events before triggering
- `dedupeWindowSeconds: 600` — Ignore duplicate events within 10 minutes
- `cooldownSeconds: 120` — Wait 2 minutes after a run before next trigger
- `maxParallel: 2` — Run at most 2 in parallel

**Usage:**
```bash
mkdir -p ~/.cline/cron/events
cp examples/cron/events/pr-review.event.md ~/.cline/cron/events/
# Configure your repository, branch, and workspace
# Wire up GitHub App or webhook to ingest events
```

**Ingesting events:**
Events are ingested via:
- GitHub App or webhook receiver
- Plugin-emitted events (see `plugins/automation-events.ts`)
- Connector adapters
- `cline.automation.ingestEvent()` in the SDK

### [`events/local-manual-test.event.md`](./events/local-manual-test.event.md)

Local test spec for verifying event-driven automation without external services.

**Key fields:**
- `event: local.manual_test` — Local event type (no external dependency)
- `filters: { topic: cron-feature-2 }` — Match on event payload fields
- `debounceSeconds: 0` — Trigger immediately
- `maxIterations: 5` — Quick timeout for testing

**Usage:**
```bash
mkdir -p ~/.cline/cron/events
cp examples/cron/events/local-manual-test.event.md ~/.cline/cron/events/

# Start the hub with automation enabled
# In another shell, ingest a test event
node -e "
  const { HubWebSocketClient } = require('@cline/core');
  const client = new HubWebSocketClient('ws://localhost:8000');
  client.send('cron.event.ingest', {
    eventType: 'local.manual_test',
    envelope: { subject: 'test', topic: 'cron-feature-2', message: 'hello' }
  });
"
```

### [`events/local-plugin-event.event.md`](./events/local-plugin-event.event.md)

Test spec for plugin-emitted events. Pairs with `plugins/automation-events.ts`.

### Additional Event-Driven Examples

#### [`events/pr-changelog-check.event.md`](./events/pr-changelog-check.event.md)

**Verify CHANGELOG updates in PRs**

Triggers when a PR opens on `main`. If the PR modifies source code but doesn't update CHANGELOG, posts a comment suggesting what should be added. If CHANGELOG is updated, verifies the format.

**Best for:** Maintaining an up-to-date changelog without manual reminders. Reduces reviewer burden.

#### [`events/pr-test-coverage.event.md`](./events/pr-test-coverage.event.md)

**Analyze test coverage impact of PRs**

Triggers when a PR is opened or updated. Runs test coverage against the PR branch, compares to main, and posts a comment showing:
- Which new code is covered vs. uncovered
- Coverage impact percentage
- Files with decreased coverage
- Recommendations for additional tests

**Best for:** Maintaining test coverage standards while being helpful rather than blocking. Guides authors toward better test practices.

**Key fields:**
- `event: local.plugin_event` — Custom event emitted by the plugin
- `filters: { topic: plugin-demo }` — Match on plugin event attributes
- Minimal throttling for responsive testing

**Usage:**
```bash
mkdir -p ~/.cline/cron/events
cp examples/cron/events/local-plugin-event.event.md ~/.cline/cron/events/

# Load the plugin that emits these events
mkdir -p ~/.cline/plugins
cp examples/plugins/automation-events.ts ~/.cline/plugins/

# Run CLI with automation enabled; the plugin emits events
cline --enable-automation -i "Test automation events"
```

## 🚀 Getting Started

### 1. Set up the spec directory

```bash
mkdir -p ~/.cline/cron/events
```

### 2. Copy a template

- **For scheduled tasks:** Copy `daily-code-review.cron.md`
- **For GitHub events:** Copy `pr-review.event.md`
- **For local testing:** Copy `local-manual-test.event.md`
- **For plugin events:** Copy `local-plugin-event.event.md`

### 3. Customize the spec

Edit your copied spec:
- Set `workspaceRoot` to your project path
- Set `modelSelection` if using a non-default model
- Update `filters` to match your repos/branches
- Adjust timeout, iterations, and tool restrictions
- Refine the prompt (the YAML body)

### 4. Enable automation

**In the hub:**
```bash
new HubWebSocketServer({
  cronOptions: { workspaceRoot: "/absolute/workspace" }
});
```

**In the SDK:**
```ts
const cline = await ClineCore.create({
  automation: true,  // Enable automation
  // ... other options
});
```

**In the CLI:**
```bash
cline --enable-automation
```

### 5. Monitor runs

Completed and failed runs are reported to `.cline/cron/reports/<run-id>.md` with:
- YAML frontmatter (run ID, status, timing, token usage)
- Summary of work performed
- Tool calls and results
- For events: trigger event context

## 📖 Field Reference

### Common fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Unique identifier (alphanumeric, hyphens) |
| `title` | string | yes | Human-readable title |
| `workspaceRoot` | string | yes | Absolute path to the project |
| `mode` | string | no | `yolo` (default), `act`, or `plan` |
| `tools` | string/array | no | Comma-separated tool names; empty disables work tools |
| `systemPrompt` | string | no | Custom system prompt |
| `modelSelection` | object | no | `{ providerId, modelId }` |
| `maxIterations` | number | no | Iteration limit |
| `timeoutSeconds` | number | no | Run timeout |
| `extensions` | array | no | `rules`, `skills`, `plugins` |
| `tags` | array | no | Arbitrary tags for grouping |
| `metadata` | object | no | Custom metadata |

### Recurring-only fields (`.cron.md`)

| Field | Type | Notes |
|-------|------|-------|
| `schedule` | string | **Required**. Cron expression (5 fields: minute, hour, day, month, day-of-week) |
| `timezone` | string | Optional. IANA timezone (e.g., `America/New_York`). Defaults to system timezone. |

### Event-only fields (`.event.md`)

| Field | Type | Notes |
|-------|------|-------|
| `event` | string | **Required**. Event type (e.g., `github.pull_request.opened`, `local.manual_test`) |
| `filters` | object | Optional. Match event fields (supports dot paths) |
| `debounceSeconds` | number | Optional. Coalesce events within N seconds (default 0) |
| `dedupeWindowSeconds` | number | Optional. Skip duplicates within N seconds (default 0) |
| `cooldownSeconds` | number | Optional. Wait N seconds after a run (default 0) |
| `maxParallel` | number | Optional. Max concurrent runs (default unbounded) |

## 📚 Tools Reference

Available tool names:
- `read_files` — Read file contents
- `search_codebase` — Search across the project
- `run_commands` — Execute shell commands
- `fetch_web_content` — Fetch URLs
- `apply_patch` — Apply code patches
- `editor` — Edit files
- `skills` — Call custom skills
- `ask_question` — Query the user
- `submit_and_exit` — Complete the run

## 💡 Practical Automation Workflows

### Complete Development Automation Suite

Combine multiple specs for comprehensive automation:

```
Monday 10 AM    → dependency-check.cron.md       (Check dependencies)
Tuesday 3 AM    → code-style-audit.cron.md       (Lint and format)
Wednesday 5 AM  → documentation-check.cron.md    (Doc coverage)
Thursday 4 AM   → dead-code-finder.cron.md       (Find cleanup opportunities)
Friday 6 PM     → changelog-generator.cron.md    (Auto-generate changelog)
Daily 2 AM      → performance-baseline.cron.md   (Track metrics)
Daily 10 PM     → test-coverage-report.cron.md   (Coverage trends)
Daily 6 AM      → type-check-strict.cron.md      (Type safety)

On every PR:
  → pr-changelog-check.event.md     (Verify CHANGELOG)
  → pr-test-coverage.event.md       (Coverage impact)
```

This provides continuous quality monitoring without developers having to remember to run checks manually.

### Team Workflows by Role

**For Team Leads:**
- `dependency-check.cron.md` — Weekly security review
- `dead-code-finder.cron.md` — Quarterly cleanup planning
- `performance-baseline.cron.md` — Monitor system health

**For QA Engineers:**
- `test-coverage-report.cron.md` — Track trends
- `pr-test-coverage.event.md` — PR-level feedback

**For Backend Teams:**
- `performance-baseline.cron.md` — Build time, API response time
- `type-check-strict.cron.md` — Type safety

**For Frontend Teams:**
- `performance-baseline.cron.md` — Bundle size, cold start
- `code-style-audit.cron.md` — Consistent styling

## 🔍 Examples in Action

### Schedule a daily security audit

```md
---
id: daily-security-audit
title: Daily Security Audit
workspaceRoot: /path/to/repo
schedule: "0 2 * * *"  # 2 AM daily
tools: read_files,search_codebase
mode: act
timeoutSeconds: 3600
extensions:
  - skills
---
Search for hardcoded secrets, outdated dependencies, and insecure patterns.
Report findings to the team.
```

### Review all new PRs on main

```md
---
id: pr-security-review
title: Security Review for PRs
workspaceRoot: /path/to/repo
event: github.pull_request.opened
filters:
  pullRequest:
    baseBranch: main
cooldownSeconds: 300
maxParallel: 3
---
Summarize the changes, check for security risks, and recommend approval or changes.
```

## 🔗 See Also

- [Architecture automation overview](../../ARCHITECTURE.md#automation) — Runtime architecture and flow details
- [`plugins/automation-events.ts`](../plugins/automation-events.ts) — Plugin event emission
- [Cline SDK Examples](../) — Other integration examples
