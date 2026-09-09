---
name: publish-extension
description: Use when releasing the Cline VS Code extension — stable (currently the combined legacy+next A/B VSIX via ext-vscode-ab-package), nightly (ext-vscode-publish-nightly), or a legacy-branch hotfix (ext-vscode-publish-legacy). Guides version selection, changelog, PostHog rollout-flag coordination, workflow dispatch, environment approvals, tagging, and post-publish verification, plus the eventual cutover to publishing the SDK extension standalone.
---

# VS Code Extension Release

Use this skill when the user asks to release, publish, or ship the VS Code extension — stable, nightly, or a legacy hotfix — or to dial the rollout, or to cut over to the SDK extension permanently.

> Working directory: repo root. All workflows are dispatched from `main` (GitHub requires the workflow file on the default branch; each workflow checks out the refs it actually builds).

## The current era: combined A/B rollout

We are mid-migration from the legacy (npm, pre-SDK) extension to the next (SDK-based, bun) extension. Until the cutover is complete, **the stable and nightly listings ship a combined VSIX**: a small loader + two complete extensions (`next/` built from `main`, `legacy/` built from the `legacy-extension` branch). The loader picks one per window based on the PostHog flag `ext-sdk-bundle-rollout`. Deep-dive docs: `apps/vscode-rollout/README.md` (authoritative) and PR #12253 (design + runbook comments).

Endgame (see "Cutover" at the bottom): once the next bundle is trusted at 100%, stable goes back to a plain build of `main` via `ext-vscode-publish-stable.yml` and all the legacy/rollout machinery is retired.

### The listings and the workflows

| Channel | Marketplace ID | Workflow | Trigger | Version |
|---|---|---|---|---|
| Stable (combined) | `saoudrizwan.claude-dev` | `ext-vscode-ab-package.yml` | dispatch only; `publish` input defaults false | manual input (semver, e.g. `4.1.0`) |
| Nightly (combined) | `saoudrizwan.cline-nightly` | `ext-vscode-publish-nightly.yml` | cron 12:00 UTC + dispatch | auto `<major>.<minor>.<unix-ts>` from main's `apps/vscode/package.json` |
| Legacy hotfix (standalone) | `saoudrizwan.claude-dev` | `ext-vscode-publish-legacy.yml` | dispatch | from `apps/vscode/package.json` on `legacy-extension` |
| Stable standalone (post-cutover) | `saoudrizwan.claude-dev` | `ext-vscode-publish-stable.yml` | dispatch | from `apps/vscode/package.json` on `main` |

All three publish paths gate on tests before publishing: nightly and ab-package run the reusable bun suite (`ext-vscode-test.yml`, tests `main`) — ab-package additionally runs the legacy branch's npm suite — and the legacy workflow inlines the npm suite. Environment gates: stable paths use `publish` → `Publish` environment (required reviewers approve in the Actions UI); nightly uses `PublishNightly` (branch policy only, no reviewers — a reviewer requirement would block the cron).

## Golden rules (read before any release)

1. **One listing, one version line.** `claude-dev` is published from multiple workflows/branches. Every stable publish must use a version **strictly above the highest version ever published to the listing from any branch** — marketplace versions are monotonic and cannot be unpublished (supersede, never delete). Check what's live first:

   ```bash
   curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
     -H "Content-Type: application/json" -H "Accept: application/json;api-version=3.0-preview.1" \
     -d '{"filters":[{"criteria":[{"filterType":7,"value":"saoudrizwan.claude-dev"}]}],"flags":16}' \
     | python3 -c "import json,sys; v=json.load(sys.stdin)['results'][0]['extensions'][0]['versions'][0]; print(v['version'], v['lastUpdated'])"
   ```

   `ext-vscode-ab-package` also enforces this automatically for `publish=true` runs: a preflight job validates the version format (plain `X.Y.Z`) and hard-fails unless it exceeds the live Marketplace version, and the publish job re-checks right before publishing (the approval wait can last days — a legacy hotfix landing in between is caught). Still run the query yourself when *choosing* the version.

2. **Check the flag BEFORE any stable combined publish.** `ext-sdk-bundle-rollout` is **shared between nightly and stable** — the loader sends only a machine id to `/decide`, no channel property, so there is no per-channel targeting. If the flag is high (nightly dogfooding) and you publish stable, stable users get the next bundle at that same percentage. Verify the effective percentage empirically (no PostHog admin needed — sample `/decide` with random ids using the key inlined in any shipped loader):

   ```bash
   node -e '
   const KEY = process.argv[1]; // phc_... extracted from a shipped VSIX loader
   (async () => {
     let t = 0, n = 200;
     for (let i = 0; i < n; i += 20) {
       const rs = await Promise.all(Array.from({length: 20}, (_, j) =>
         fetch("https://data.cline.bot/decide?v=3", { method: "POST",
           headers: {"Content-Type": "application/json"},
           body: JSON.stringify({api_key: KEY, distinct_id: `probe-${i+j}-${Math.random()}`})
         }).then(r => r.json())));
       for (const r of rs) if ((r.featureFlags||{})["ext-sdk-bundle-rollout"] === true) t++;
     }
     console.log(`~${(100*t/n).toFixed(1)}% (${t}/${n})`);
   })()' "$KEY"
   ```

   Flag changes are made in the PostHog UI (Cline project). **0% is the kill switch** — the flag is two-way; there is no separate killswitch flag. Dialing down demotes machines back to legacy on their next window reload.

3. **Ask before pushing** commits or tags. Environment approvals are the maintainer's to give.

4. **Changelog lives at the repo ROOT** (`CHANGELOG.md`), on the branch being released — not `apps/vscode/CHANGELOG.md` (doesn't exist). The legacy and stable workflows hard-fail unless the first heading is exactly `## [<version>]`.

5. **Stuck concurrency groups**: `ext-vscode-ab-package` groups on the version with `cancel-in-progress: false`. Only `publish=true` runs wait on environment approval (build-only rehearsals run ungated to completion), but a publish run left `waiting` still blocks every later dispatch of the same version — cancel it (`gh run cancel <id>`) before re-dispatching.

## Stable release (combined A/B VSIX) — the current stable path

### Pre-flight

```bash
# 1. What's live, and what version comes next (must exceed it — rule 1)
# 2. Flag percentage (rule 2) — decide where it should be for this release
# 3. Legacy tip = what the non-promoted cohort will run; confirm it's the shipped hotfix line
git fetch origin main legacy-extension
git log --oneline -3 origin/legacy-extension

# 4. Cheap local rehearsal of the most likely build failure: the union manifest
#    hard-fails if views/viewsContainers/configuration diverged between branches.
git show origin/main:apps/vscode/package.json > /tmp/next.json
git show origin/legacy-extension:apps/vscode/package.json > /tmp/legacy.json
node apps/vscode-rollout/scripts/gen-manifest.mjs --next /tmp/next.json --legacy /tmp/legacy.json --version <VERSION>
# Expected warnings only: engines union (takes newer) + walkthrough copy drift.
```

Release prep on `main` (PR, not direct push):
- Add `## [<VERSION>]` entry at the top of root `CHANGELOG.md`.
- Bump `apps/vscode/package.json` to `<VERSION>` so the repo reflects the published line. Side effect: nightly versions become `<major>.<minor>.<unix-ts>` of the new base — harmless (separate listing, still monotonic).

### Dispatch

```bash
gh workflow run ext-vscode-ab-package.yml --ref main \
  -f version=<VERSION> -f next-ref=main -f publish=true
# (the legacy bundle always builds from the protected legacy-extension branch;
# it is deliberately not an input)
# publish=false builds an installable .vsix artifact without publishing and
# needs NO environment approval — the ungated build job uploads the artifact
# and the run completes.
gh run list --workflow=ext-vscode-ab-package.yml --limit 1
```

Preflight (version format + monotonicity) and both test suites run first, then the ungated `build` job packages and uploads the VSIX; for `publish=true` the `publish` job then **waits for `Publish` environment approval** (Actions → run → "Review deployments"). Both bundles build the exact revisions their test gates ran against (branch names are resolved once — commits landing on either branch mid-run or during the approval wait are not picked up); `publish=true` is additionally refused for any `next-ref` other than `main` (the bun gate only tests main — non-main next-refs are for build-only artifact rehearsals). Check what a run is waiting on:

```bash
gh api repos/cline/cline/actions/runs/<run-id>/pending_deployments
```

### Post-publish

1. Verify the marketplace serves the new version (query from rule 1) — expect minutes-to-an-hour of validation lag after "Published" appears in the logs. Also verify Open VSX:

   ```bash
   curl -s "https://open-vsx.org/api/saoudrizwan/claude-dev" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['version'], d['timestamp'])"
   ```
2. Tag, GitHub Release (with the .vsix attached), and the Slack release-bot post happen **automatically** after a real publish (all `continue-on-error` — the publish itself already succeeded, so bookkeeping failures leave the run green). Verify they landed; the known failure is the tag push when the built commit touches `.github/workflows/**` (default token cannot create such refs — no grantable permission fixes it). Manual fallback:

   ```bash
   git tag v<VERSION> <main-sha-built>   # ask before pushing
   git push origin v<VERSION>
   gh release create v<VERSION> --title "v<VERSION>" --notes "<changelog section>" <path-to.vsix>
   ```

   A real publish also **hard-fails early** if root `CHANGELOG.md` on the built main revision doesn't start with `## [<VERSION>]` — the release prep PR must be merged before dispatching.

3. Thorough artifact check (`gh run download <run-id>`): union `package.json` is `saoudrizwan.claude-dev@<VERSION>`, `next/package.json` and `legacy/package.json` carry the SAME version, `grep -c 'phc_' extension/extension.js` ≥ 1 (loader key inlined), no leftover `process.env.TELEMETRY_SERVICE_API_KEY` / `process.env.CLINE_ROLLOUT_VARIANT` literals in either bundle's dist (leftovers = a build ran without its env and telemetry is silently dead).
4. Monitor: `extension.rollout.bundle_activated` in `otel.otel_logs` filtered to `extension_version = '<VERSION>'` (stable cohort is cleanly separable — nightly versions are timestamps). Watch the next/legacy ratio and the crash-fallback rate; Metabase dashboards 17 (rollout + task error rate) and 19 (error deep dive). `extension.rollout.loader_decision` (incl. `double_failure`) is PostHog-only, not in ClickHouse.
5. Dial the flag per the rollout plan (e.g. 0% at publish → 1% → up), verifying each change with the probe from rule 2. Announce demotions ahead of time — dialing down also demotes nightly dogfooders unless they set `"cline-nightly.rollout.bundleOverride": "next"`.

### Known caveats of this path

- **`engines.vscode` unions upward** (main's floor wins, e.g. `^1.101.0` vs legacy's `^1.84.0`): users on older VS Code are never offered the combined VSIX. Fail-safe during rollout; must be resolved before 100%.
- A red run can still mean a successful publish on paths that tag (see Gotchas).

## Nightly release

Happens automatically (cron 12:00 UTC). Manual cut:

```bash
gh workflow run ext-vscode-publish-nightly.yml --ref main                 # real publish
gh workflow run ext-vscode-publish-nightly.yml --ref main -f dry-run=true # artifact only
gh run watch <run-id> --exit-status --interval 60
```

No changelog/version prep — the version is computed. Verify with the marketplace query against `saoudrizwan.cline-nightly`.

**Red run ≠ failed publish**: the final tag-push step fails whenever main's HEAD touches `.github/workflows/**` (default token cannot create such refs). If "Published" appears in the logs, the release went out; push the `nightly-main-<UTC ts>-<sha12>` tag manually with user credentials.

## Legacy hotfix release (and emergency full rollback)

For shipping a fix on the `legacy-extension` branch — or as the **structural rollback** from a bad combined stable VSIX: a standalone legacy publish at a higher version supersedes the combined VSIX entirely (loader and all) for every user. (For "next bundle misbehaving" you don't need this — dial the flag to 0% instead.)

```bash
# On legacy-extension: commit the fix, bump apps/vscode/package.json ABOVE the
# highest version ever published to the listing (rule 1 — including combined
# versions, e.g. combined 4.1.0 live -> hotfix is 4.1.1, not 4.0.13),
# add the matching `## [x.y.z]` entry to root CHANGELOG.md, push.
gh workflow run ext-vscode-publish-legacy.yml --ref main \
  -f release-type=release
# (the branch is hardcoded to legacy-extension in the workflow; it is
# deliberately not an input)
```

npm test suite runs ungated; the publish job waits on the `Publish` environment. This workflow derives + pushes the `v<version>` tag itself and creates the GitHub release — no manual tagging. Publishes to Marketplace **and** Open VSX. The branch is the npm codebase: use `npm`, never `bun`, and expect the old monolith layout (`apps/vscode/src/core/...`).

## Cutover: retiring the A/B machinery (the endgame)

When the next bundle has held at 100% long enough to trust:

1. **Resolve the engines floor**: decide whether stranding VS Code < main's `engines.vscode` on the last combined version is acceptable, or lower main's floor first.
2. Bump `apps/vscode/package.json` on `main` above everything ever published; root `CHANGELOG.md` entry to match (both are enforced by the workflow).
3. Ship standalone from main: `gh workflow run ext-vscode-publish-stable.yml --ref main` — tests main, tags `v<version>` itself, creates the GitHub release, publishes Marketplace + Open VSX.
4. Watch the same rollout telemetry through the transition — `extension_variant` disappears from events as users leave combined builds, which is itself the adoption signal.
5. Only after the standalone version dominates: retire `legacy-extension` (keep for history), delete `ext-vscode-publish-legacy.yml` and `ext-vscode-ab-package.yml`, convert the nightly workflow back to a plain build of main, remove `apps/vscode-rollout/`, and archive the `ext-sdk-bundle-rollout` flag in PostHog (harmless to machines still on a combined VSIX: absent flag fails safe to... nothing changing until they update, but their loader treats a deleted flag as legacy — leave the flag at 100% until combined-VSIX activations flatline, then archive).
6. Update this skill: delete the combined-era sections and keep the standalone flow.

## Gotchas index

- `inputs.*` are empty strings on `schedule` events — preserve `|| 'default'` fallbacks when editing the nightly workflow.
- `bun run package` in `apps/vscode` does not build `@cline/*` workspace deps — fresh checkouts need `bun run build:sdk` first (workflows handle this).
- Job-level `if:` ref checks in workflow YAML are advisory (a dispatched branch runs its own copy of the file); the enforced boundary is each environment's deployment-branch policy in repo settings.
- Marketplace PATs (`VSCE_PAT`/`OVSX_PAT`) are only mounted into publish steps; neither publish workflow has an untrusted trigger surface.
- Environment-approval runs left waiting don't time out quickly — they sit for days and (for ab-package publish runs) block their version's concurrency group.
- Local forcing for manual testing: `CLINE_BUNDLE_OVERRIDE=next|legacy` env (launch VS Code fresh from a terminal) or the `<prefix>.rollout.bundleOverride` setting + reload; both report as `override` in telemetry so they don't pollute cohort data.
