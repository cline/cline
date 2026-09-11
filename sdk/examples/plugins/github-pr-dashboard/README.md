# GitHub PR Dashboard Gate Plugin

A scheduled GitHub PR dashboard example that uses a deterministic `beforeRun`
hook to decide whether an agent should run.

The hook fetches PR data from GitHub, computes dashboard metrics, hashes the
snapshot, and exits before inference if nothing changed:

```ts
{ stop: true, reason: "no GitHub PR dashboard changes, exiting" }
```

When metrics changed, the plugin injects a dashboard-update handoff before the
first model request. The agent can then update the requested dashboard file and
summarize what changed.

## Fastest working demo, no agent required

This writes a Markdown dashboard and a browser-friendly HTML dashboard directly.
It does not call a model.

```bash
# From the cline repository root:

GITHUB_TOKEN="$(gh auth token)" \
bun -F cline-github-pr-dashboard-plugin run-once -- --repo cline/cline --open
```

`--repo` is the only required input for the preview command. `GITHUB_TOKEN` is
not required for public repositories, but using `gh auth token` avoids GitHub's
low unauthenticated API rate limit.

This preview does not install the plugin or create a schedule. It only proves the
deterministic gate and dashboard rendering work locally.

For a disposable smoke test that writes under `/tmp`:

```bash
# From the cline repository root:

export GITHUB_PR_DASHBOARD_PATH=/tmp/github-pr-dashboard.md
export GITHUB_PR_DASHBOARD_HTML_PATH=/tmp/github-pr-dashboard.html
export GITHUB_PR_DASHBOARD_STATE_PATH=/tmp/github-pr-dashboard-state.json

rm -f "$GITHUB_PR_DASHBOARD_STATE_PATH"
GITHUB_TOKEN="$(gh auth token)" \
bun -F cline-github-pr-dashboard-plugin run-once -- --repo cline/cline --open
```

If `--open` is omitted, open the generated file manually:

```bash
open /tmp/github-pr-dashboard.html
```

Run the same command again without deleting the state file. If the PR metrics did
not change, the JSON output will include:

```json
{ "changed": false, "stop": true }
```

The preview still rewrites the Markdown/HTML files so you can inspect the latest
snapshot even when the scheduled hook would skip the model call.

When dashboard data changes after a previous run, the JSON output and scheduled
agent handoff include a deterministic change summary, for example:

```text
- Open PRs: 587 → 591 (+4)
- Recently closed PRs: 188 → 193 (+5)
- Newly waiting for review: cline/cline#123 Example PR title
```

## What the dashboard covers

- Open PR count, fetched with pagination so large repositories are counted
  accurately
- New open PR count in the recent window
- Recently closed PR count, fetched separately from the bounded recent activity
  sample
- How long open PRs have been waiting for review
- PR volume trend over time
- Leading PR authors this week and this month
- Leading PR reviewers this week and this month
- Per-repository breakdown

## Configuration

Required:

```bash
# Preview CLI:
bun -F cline-github-pr-dashboard-plugin run-once -- --repo cline/cline

# Installed plugin / scheduled runs:
export GITHUB_REPOSITORIES=cline/cline,owner/other-repo
```

Optional:

```bash
export GITHUB_TOKEN=github_pat_...
export GH_TOKEN=github_pat_...

export GITHUB_PR_DASHBOARD_PATH=github-pr-dashboard.md
export GITHUB_PR_DASHBOARD_HTML_PATH=github-pr-dashboard.html

# Recent activity sample size for closed/review/trend detail. Defaults to 25.
# This is not an open PR count cap; open PRs are paginated separately.
export GITHUB_PR_DASHBOARD_MAX_PRS=25

# Pagination caps for exact open counts and recently closed scans. Default 10.
export GITHUB_PR_DASHBOARD_MAX_OPEN_PAGES=10
export GITHUB_PR_DASHBOARD_MAX_CLOSED_PAGES=10

export GITHUB_PR_DASHBOARD_NEW_HOURS=24
export GITHUB_PR_DASHBOARD_RECENTLY_CLOSED_DAYS=7
export GITHUB_PR_DASHBOARD_TREND_DAYS=14

# Default:
# ${CLINE_DATA_DIR:-~/.cline/data}/plugins/github-pr-dashboard/state.json
export GITHUB_PR_DASHBOARD_STATE_PATH=/tmp/github-pr-dashboard-state.json
```

The state file stores the last dashboard snapshot hash, timestamp, and bounded
rendered snapshot. It does not store GitHub tokens or raw GitHub API responses.
The previous snapshot is used only to decide whether to wake the agent and to
produce the change summary for day-to-day dashboard updates.

## Scheduled Cline usage

Nothing is scheduled by default. To make this run automatically, install the
plugin into a workspace and create a Cline schedule.

Install the plugin into the workspace first:

```bash
cline plugin install ./sdk/examples/plugins/github-pr-dashboard --cwd /path/to/workspace
```

Then create a schedule with any cron pattern you want:

```bash
cline schedule create "GitHub PR Dashboard" \
  --cron "0 9 * * MON-FRI" \
  --workspace /path/to/workspace \
  --mode act \
  --prompt "Update the GitHub PR dashboard if the pre-run hook provides changed dashboard data. Only edit the dashboard file requested by the hook."
```

The schedule can wake as often as you want. The `beforeRun` hook determines
whether the agent should actually run.

## Manual gate smoke test

This exercises the deterministic gate without writing dashboard files and without
starting an agent/model:

```bash
# From the cline repository root:

export GITHUB_REPOSITORIES=cline/cline
export GITHUB_PR_DASHBOARD_STATE_PATH=/tmp/github-pr-dashboard-state.json
rm -f "$GITHUB_PR_DASHBOARD_STATE_PATH"

bun -e '
import { runGitHubPrDashboardGate } from "./sdk/examples/plugins/github-pr-dashboard/src/gate.ts";
const result = await runGitHubPrDashboardGate();
console.log(JSON.stringify({
  stop: result.stop ?? false,
  reason: result.reason,
  dashboardPath: result.dashboardPath,
  snapshotHash: result.snapshotHash,
  summary: result.snapshot?.summary,
  hasHandoff: Boolean(result.handoffText)
}, null, 2));
'
```

Run it once to get a handoff, then run it again without deleting state. The
second run should stop if the PR metrics did not change.

## Verify locally

```bash
# From the cline repository root:
bun -F cline-github-pr-dashboard-plugin test
bun -F cline-github-pr-dashboard-plugin typecheck
bun biome check sdk/examples/plugins/github-pr-dashboard sdk/examples/plugins/README.md --diagnostic-level=error
```
