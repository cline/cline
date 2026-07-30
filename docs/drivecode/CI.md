# Drive Mode CI contract

Enterprise-shaped continuous integration for Drive / drivecode surfaces in this monorepo.

## Principles (from enterprise monorepo CI practice)

1. **Run only what changed.** Job-level path filters (`dorny/paths-filter`) select packages. Do not rely on labels as the primary router.
2. **One required gate.** `drive-ci` always reports. Skipped package jobs are success; failures fail the gate. Avoid workflow-level `on.paths` for required Drive checks (they leave checks Pending on unrelated PRs).
3. **Manual affected map.** Until we adopt Nx/Turbo affected, shared deps (`sdk/packages/shared`, `bun.lock`) are listed on every Drive consumer filter.
4. **Labels are overrides.** `ci/*` forces a suite when paths miss. `area/*` is reviewer sugar only. Body-driven overrides **dedupe** against path triggers so a checked box does not double-run a suite paths already woke.
5. **Cancel superseded work.** Concurrency + `cancel-in-progress` on PR workflows.
6. **Fail fast.** Cheap gates (lint / quality-checks) run before heavy tests. Matrix `fail-fast: true` cancels sibling OS jobs on the first failure. Steps do not continue after a failed suite.
7. **Iterate.** Measure Actions minutes after each change; prefer subtract before add.

## Performance notes (measured)

| Bottleneck | Mitigation |
|---|---|
| Windows cold `bun install` (3–5+ min) | Shared `setup-bun-workspace` caches `~/.bun/install/cache`; PR matrices for sdk-test / ext-vscode-test are **Ubuntu-only** (Windows retained on `push` / `workflow_call` / dispatch) |
| `ci/sdk` (+docs/vscode) double-billing with path CI | `ci-label-overrides` skips body-driven wakes when dorny says paths already cover the suite; `drive` removed (drive-ci already forces from checkbox/label) |
| TUI e2e serialized behind SDK unit tests | `tui-and-publish` job runs in parallel with the OS test matrix after quality-checks |
| Bun cache restore (~20s) slower than Linux install | drive-ci jobs set `cache: false` on the composite action |

Shared bootstrap: `.github/actions/setup-bun-workspace`.

## Workflows

| Workflow | Role |
|---|---|
| `drive-ci.yml` | Discovery + hub / drive / demo / CLI jobs + **`drive-ci` gate** |
| `ci-label-overrides.yml` | Pathless companion: `ci/*` from **PR body checkboxes** (and human `labeled`) → reusable suites when paths would miss; never re-invokes `drive-ci` |

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

`ci/vscode`, `ci/e2e`, `ci/e2e-full`, `ci/sdk`, `ci/docs`

`ci/drive` is still a template checkbox and label — `drive-ci.yml` reads it directly for force. The label-overrides companion does **not** call `drive-ci` again.

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
- Optional: split VS Code unit / integration / webview into parallel jobs once artifact reuse beats re-install cost.
