# Drive Mode CI contract

Enterprise-shaped continuous integration for Drive / drivecode surfaces in this monorepo.

## Principles (from enterprise monorepo CI practice)

1. **Run only what changed.** Job-level path filters (`dorny/paths-filter`) select packages. Do not rely on labels as the primary router.
2. **One required gate.** `drive-ci` always reports. Skipped package jobs are success; failures fail the gate. Avoid workflow-level `on.paths` for required Drive checks (they leave checks Pending on unrelated PRs).
3. **Manual affected map.** Until we adopt Nx/Turbo affected, shared deps (`sdk/packages/shared`, `bun.lock`) are listed on every Drive consumer filter.
4. **Labels are overrides.** `ci/*` forces a suite when paths miss. `area/*` is reviewer sugar only.
5. **Cancel superseded work.** Concurrency + `cancel-in-progress` on PR workflows.
6. **Iterate.** Measure Actions minutes after each change; prefer subtract before add.

## Workflows

| Workflow | Role |
|---|---|
| `drive-ci.yml` | Discovery + hub / drive / demo / CLI jobs + **`drive-ci` gate** |
| `ci-label-overrides.yml` | Pathless companion: `ci/*` from **PR body checkboxes** (and human `labeled`) → reusable suites |

**Note:** Labels added with the default `GITHUB_TOKEN` do **not** emit `pull_request` `labeled` events, so checkbox sync alone cannot wake overrides via `labeled`. The companion also listens to `opened` / `edited` / `synchronize` and reads the PR body. `drive-ci` treats a checked `` `ci/drive` `` box as force so it does not race a lagged label.

| `repo-label-prs-area.yml` | Auto `area/*` from `.github/labeler.yml` |
| `repo-label-prs-ci.yml` | PR checkbox ↔ `ci/*` label sync |
| `sdk-test.yml` / `ext-vscode-*` / `docs-link-check.yml` | Existing product suites (path-filtered or gated) |

### Make `drive-ci` required

In branch protection / rulesets, require the check named **`drive-ci`** (the gate job), not the individual package jobs.

## Path map (Drive)

| Job | Wakes on |
|---|---|
| Hub | `apps/cline-hub/**`, demo, `sdk/packages/{drive,core,llms,shared}/**` |
| Drive kernel | `sdk/packages/{drive,shared}/**`, Driveagent example homes |
| Demo | `apps/drivecode-demo/**`, `sdk/packages/shared/**` |
| CLI | `apps/cli/**` plus hub/demo/drive/core/shared (Status / Drive TUI deps) |

Force all jobs: `workflow_dispatch`, `workflow_call` with `force: true`, or label `ci/drive`.

## PR tagging

### Auto `area/*` (do not check these in the template)

`area/drive`, `area/hub`, `area/cli`, `area/sdk`, `area/vscode`, `area/docs`, `area/ci`

### Manual `ci/*` overrides (template checkboxes)

`ci/drive`, `ci/vscode`, `ci/e2e`, `ci/e2e-full`, `ci/sdk`, `ci/docs`

JetBrains stays `/test-jetbrains` (trusted authors). No skip labels in the template.

Create the `area/*` and `ci/*` labels once:

1. Merge this CI stack to `main`, then **Actions → `repo-bootstrap-ci-labels` → Run workflow**, or
2. Create them in the GitHub UI.

Cloud `gh` tokens often cannot create labels (403). Actions `GITHUB_TOKEN` with `issues: write` can.

### Branch ruleset (manual)

In **Settings → Rules → Rulesets** (or classic branch protection) for `main`:

1. Require status check **`drive-ci`** (the gate job name, not Hub/Drive/CLI individually).
2. Do **not** require the package jobs by name — skipped jobs + a green gate is the intended merge path for docs-only PRs.
3. Optional: keep existing vscode/sdk required checks only if those suites should block every merge; prefer path-filtered rulesets where the product supports them.

## Local parity

```sh
bun run build:sdk
bun -F @cline/drive typecheck && bun -F @cline/drive test
bun -F @cline/cline-hub typecheck && bun -F @cline/cline-hub test && bun -F @cline/cline-hub build:webview
bun -F @cline/drivecode-demo typecheck && bun -F @cline/drivecode-demo test
bun -F @cline/cli build && bun -F @cline/cli typecheck && bun -F @cline/cli test:unit
```

## Follow-ups

- Point branch rulesets at `drive-ci` only for Drive-required merges.
- Optional later: graph-aware affected via Bun workspace metadata (Nx/Turbo only if the package graph outgrows the manual map).
- Re-measure Actions minutes after this lands; keep vscode e2e path filters for non-required expensive suites.
