---
name: publish-extension
description: Use when releasing the Cline VS Code extension — stable (standalone SDK build of main via ext-vscode-publish), nightly (ext-vscode-publish-nightly, manual dispatch), or an emergency legacy-branch hotfix (ext-vscode-publish-legacy). Guides version selection, changelog, workflow dispatch, environment approvals, tagging, post-publish verification, and the remaining retirement of the finished A/B rollout machinery.
---

# VS Code Extension Release

Use this skill when the user asks to release, publish, or ship the VS Code extension — stable, nightly, or an emergency legacy hotfix — or to retire the leftover A/B rollout machinery.

> Working directory: repo root. All workflows are dispatched from `main` (GitHub requires the workflow file on the default branch; each workflow checks out the refs it actually builds).

## The current era: standalone SDK extension from `main`

**The legacy → SDK migration is complete.** The PostHog flag `ext-sdk-bundle-rollout` reached 100% (verified empirically 2026-09-15: 200/200 `/decide` probes returned `true`), so every user on the combined VSIX runs the `next` (SDK, bun) bundle and the `legacy/` half is dead weight. Stable releases now ship a **plain build of `main`** through `ext-vscode-publish.yml` — a copy of the A/B workflow with the loader, `legacy/` bundle and stitching removed, and the same build-artifact-then-`vsce publish --packagePath` publish step. The combined A/B path (`ext-vscode-ab-package.yml`) is no longer used for releases and is pending deletion — see "Retiring the A/B machinery" at the bottom for what is still left to clean up and the one caveat (leave the flag at 100%).

**Do not use `ext-vscode-publish-stable.yml`.** Its publish step (`bun run publish:marketplace` → bare `vsce publish`, which re-runs `vscode:prepublish` and repacks the source tree) hung on all five attempts for v4.1.18 (2026-09-15/17), each exactly 180s after "Publishing ..." with `Request timeout: /_apis/gallery`. That path is the client's FIRST request (route discovery, no body) — the VSIX was never uploaded, so nothing about the artifact is the cause. The same code line went out as 4.1.19 through the prebuilt-artifact path in seconds. Root cause is not established (see the gotcha at the bottom); the stable workflow is kept only until the new one has shipped a release, then deleted.

History, for context only: the A/B era ran `4.1.0` → `4.1.19` (Jul–Sep 2026). Design docs remain at `apps/vscode-rollout/README.md` and PR #12253 until that directory is removed.

### The listings and the workflows

| Channel | Marketplace ID | Workflow | Trigger | Version |
|---|---|---|---|---|
| **Stable** | `saoudrizwan.claude-dev` | `ext-vscode-publish.yml` | dispatch, from `main` | `apps/vscode/package.json` on `main`; the `version` input must equal it |
| Nightly | `saoudrizwan.cline-nightly` | `ext-vscode-publish-nightly.yml` | **manual dispatch only** (cron deliberately removed) | auto `<major>.<minor>.<unix-ts>` from main's `apps/vscode/package.json` |
| Legacy hotfix (emergency only) | `saoudrizwan.claude-dev` | `ext-vscode-publish-legacy.yml` | dispatch | `apps/vscode/package.json` on `legacy-extension` |

Stable runs four jobs: `preflight` (input regex, main-only publish, Marketplace monotonicity) and the reusable bun suite (`ext-vscode-test.yml`, tests the dispatch SHA) ungated → `build` (no environment; packages the `.vsix` as a run artifact, so `publish=false` rehearsals need no approval) → `publish` (`publish` environment — required reviewers approve in the Actions UI; uploads the artifact, then tag/release/Slack). Nightly uses `PublishNightly` (branch policy only). Nightly **still builds the combined loader VSIX** (loader + `next/` + `legacy/`) until it is converted back to a plain build — that conversion is on the retirement list below.

## Golden rules (read before any release)

1. **One listing, one version line.** `claude-dev` has been published from multiple workflows and branches. Every stable publish must use a version **strictly above the highest version ever published to the listing from any branch** — marketplace versions are monotonic and cannot be unpublished (supersede, never delete). Check what's live first:

   ```bash
   curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
     -H "Content-Type: application/json" -H "Accept: application/json;api-version=3.0-preview.1" \
     -d '{"filters":[{"criteria":[{"filterType":7,"value":"saoudrizwan.claude-dev"}]}],"flags":16}' \
     | python3 -c "import json,sys; v=json.load(sys.stdin)['results'][0]['extensions'][0]['versions'][0]; print(v['version'], v['lastUpdated'])"
   ```

   `ext-vscode-publish` runs this same check twice (preflight, and again right before the upload — the approval wait can last days), so a non-monotonic dispatch fails in seconds. Still run the query yourself to pick the number. The `legacy-extension` branch sits at `4.0.12`, so it cannot collide with the `4.1.x` line, but a legacy hotfix would have to be numbered above the live stable version (see the emergency section).

2. **`version` input == package version, enforced.** The build job reads `apps/vscode/package.json` and hard-fails unless it equals the `version` input (plain `X.Y.Z`, no `v`). The input is a confirmation, not a stamp — bump the version on `main` first. The `v<version>` tag is created by the workflow *after* a successful Marketplace publish.

3. **Changelog lives at the repo ROOT** (`CHANGELOG.md`) — not `apps/vscode/CHANGELOG.md` (doesn't exist). The workflow hard-fails unless the first `## [` heading is exactly `## [<version>]`. The section body becomes the GitHub release notes and the Slack post (Slack copy is trimmed to 3000 chars with a link out; the release body stays whole).

4. **Ask before pushing** commits or tags. **Never approve the `publish` environment gate yourself via `gh api`** — hand the maintainer the run URL to click "Review deployments".

5. **Concurrency**: the workflow groups on the `version` input with `cancel-in-progress: false`. A publish run left `waiting` on approval blocks every later dispatch of the same version until cancelled (`gh run cancel <id>`).

## Stable release — the current path

### Pre-flight

```bash
# 1. What's live (rule 1) → pick <VERSION> strictly above it (normally patch bump).
# 2. Confirm main's package.json is at the *previous* published version, i.e. the repo
#    reflects the live line and nothing unreleased is already bumped:
node -p "require('./apps/vscode/package.json').version"
# 3. What's in the release:
git fetch origin main --tags
git log v<PREV>..origin/main --oneline --no-merges -- apps/vscode sdk/packages
```

The CLI/SDK notes are the best starting point for the extension notes — the extension bundles `@cline/*` from source, so an SDK release in the same window ships here too. Read `sdk/CHANGELOG.md` for the matching SDK version and translate what's extension-visible; skip CLI-only and desktop-only items.

### Release prep on `main` (PR, not direct push)

- Bump `apps/vscode/package.json` → `<VERSION>`.
- Prepend `## [<VERSION>]` to root `CHANGELOG.md` with the approved notes.
- Side effect of the bump: nightly versions become `<major>.<minor>.<unix-ts>` of the new base — harmless (separate listing, still monotonic).

Rehearsal: dispatch with `publish=false` (once the bump is on `main`). It runs preflight + tests + the real CI build with the real telemetry env and uploads the `.vsix` as a run artifact, with no environment approval involved (`gh run download <run-id>`). A local `vsce package` is only a build check — telemetry env is not set locally, so that artifact's telemetry is dark by design.

### Dispatch

```bash
gh workflow run ext-vscode-publish.yml --ref main -f version=<VERSION> -f publish=true
gh run list --workflow=ext-vscode-publish.yml --limit 1 --json databaseId,url,status
```

What the run does, in order: `preflight` (version regex, refuses `publish=true` off `main`, Marketplace monotonicity) and the test gate → `build` checks out the dispatch SHA, asserts `package.json` version == input and (publish only) the changelog heading → `bun install --frozen-lockfile` → `bun run build:sdk` → asserts the `better-sqlite3` native binary → swaps in `README.marketplace.md` and runs `vsce package --no-dependencies` (this runs `vscode:prepublish` = `bun run package`; it is the only build) → asserts the packaged manifest is `saoudrizwan.claude-dev@<VERSION>` and that `dist/extension.js` has no leftover `process.env.*` literal for any of the 11 build-time variables the build step supplies (telemetry keys, `CLINE_ENVIRONMENT`, OTEL exporter settings) → uploads the artifact → `publish` **waits for `publish` environment approval**, then re-checks monotonicity and both PATs → `vsce publish --packagePath` → `ovsx publish --packagePath` → tag `v<VERSION>` at the built SHA → GitHub release with the `.vsix` → Slack post. Check what a run is waiting on:

```bash
gh api repos/cline/cline/actions/runs/<run-id>/pending_deployments
```

There is no pre-release input (the A/B path never had one either); every publish goes to the release channel of the listing.

### Post-publish

1. Verify both registries serve the new version (expect minutes-to-an-hour of Marketplace validation lag after "Published" appears in the logs):

   ```bash
   # Marketplace: query from rule 1
   curl -s "https://open-vsx.org/api/saoudrizwan/claude-dev" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['version'], d['timestamp'])"
   ```

2. Verify the bookkeeping landed: `git fetch --tags && git tag --list 'v<VERSION>'`, `gh release view v<VERSION>`, Slack post in the release channel. **Red run ≠ failed publish**: tag/release/Slack run *after* the Marketplace upload, each `continue-on-error`, gated on the Marketplace step's outcome. If the log says `Published saoudrizwan.claude-dev v<VERSION>.` the release is out. Known bookkeeping failure: the built commit touches `.github/workflows/**` (the default token cannot create such refs) → the tag push fails and the GitHub release is skipped. Fix by hand (ask first): `git tag v<VERSION> <built-sha> && git push origin refs/tags/v<VERSION>`, then `gh release create v<VERSION> <downloaded .vsix> --notes-file <changelog section>`.

3. Artifact check (`gh run download <run-id>` or the release asset): `package.json` inside is `saoudrizwan.claude-dev@<VERSION>`; `grep -c 'process.env.TELEMETRY_SERVICE_API_KEY' extension/dist/extension.js` must be **0** (a leftover literal means the build ran without its env and telemetry is silently dead). The build job asserts both of these on the packaged bytes before uploading the artifact, so this is a double-check. `CLINE_ROLLOUT_VARIANT` is defined to `""` for ordinary builds by `apps/vscode/esbuild.mjs`, so no literal is expected and telemetry carries no `extension_variant` — correct for a standalone build.

4. Monitor errors on `extension_version = '<VERSION>'` in `otel.otel_logs` (stable cohort is cleanly separable — nightly versions are timestamps). Metabase dashboards 17 (task error rate) and 19 (error deep dive).

## Nightly release

**Manual dispatch only.** The cron was removed on purpose: the `PublishNightly` environment made scheduled runs sit `waiting`, hold the concurrency group, and silently cancel every later scheduled run behind them. A stale nightly listing is therefore expected, not a bug.

```bash
gh workflow run ext-vscode-publish-nightly.yml --ref main                 # real publish
gh workflow run ext-vscode-publish-nightly.yml --ref main -f dry-run=true # artifact only
```

No changelog/version prep — the version is computed. Verify with the Marketplace query against `saoudrizwan.cline-nightly`. Until converted, nightly still ships the combined loader VSIX with a `legacy/` bundle built from `legacy-extension`.

**Red run ≠ failed publish** on this path: its tag-push step runs *after* publishing and fails whenever main's HEAD touches `.github/workflows/**`. If "Published" appears in the logs, the release went out; push the `nightly-main-<UTC ts>-<sha12>` tag manually with user credentials.

## Emergency rollback

Preferred: **ship a fixed build of `main` at a higher version** through the stable workflow above. It is the same path, fully gated, and the only rollback that keeps users on the SDK extension.

Last resort — the legacy hotfix path — still exists but is degraded: `legacy-extension` is the pre-SDK npm codebase, last touched 2026-08-18 at `4.0.12`, and a publish from it would move every user back onto code that is weeks behind. If it is ever needed:

```bash
# On legacy-extension: commit the fix, bump apps/vscode/package.json ABOVE the
# live stable version (rule 1 — e.g. 4.1.18 live -> hotfix is 4.1.19, not 4.0.13),
# add the matching `## [x.y.z]` entry to root CHANGELOG.md, push.
gh workflow run ext-vscode-publish-legacy.yml --ref main -f release-type=release
# (the branch is hardcoded to legacy-extension in the workflow)
```

The npm suite runs ungated, the publish job waits on the `publish` environment, the workflow tags and creates the GitHub release itself, and it publishes to Marketplace **and** Open VSX. On that branch use `npm`, never `bun`, and expect the old monolith layout (`apps/vscode/src/core/...`).

## Retiring the A/B machinery (still to do)

The rollout is done but the scaffolding is still in the repo. Retire it in this order, each as its own PR:

1. **Nightly → plain build of `main`**: drop the loader/`legacy-src` stitching from `ext-vscode-publish-nightly.yml` so nightly matches stable. Preserve the `|| 'default'` fallbacks for `inputs.*` while editing.
2. Once `ext-vscode-publish.yml` has shipped a release, delete `ext-vscode-publish-stable.yml` (the repack path that timed out on 4.1.18) and `ext-vscode-ab-package.yml`; and, once the emergency path above is judged unnecessary, `ext-vscode-publish-legacy.yml`; keep the `legacy-extension` branch for history. `apps/vscode/scripts/publish-marketplace.mjs` and the `publish:marketplace*` package scripts only serve the deleted stable workflow (nightly has its own script) — remove them in the same PR.
3. Remove `apps/vscode-rollout/` and the rollout-only code paths in `apps/vscode/src/services/telemetry/rollout-metadata.ts` (the `extension_variant` metadata and `extension.rollout.bundle_activated` event).
4. ~~Port the marketplace-monotonicity preflight~~ — done; `ext-vscode-publish.yml` carries both copies of the check.
5. **Archive the PostHog flag last, and not yet.** Machines still on a combined VSIX (`≤ 4.1.17`) consult `ext-sdk-bundle-rollout` on every window load and treat a *deleted* flag as `legacy`. Leave it at 100% until `extension.rollout.bundle_activated` for combined versions flatlines, then archive. Re-verify the percentage empirically before touching it (no PostHog admin needed — the key is inlined in any shipped combined loader; download the 4.1.17 VSIX from the Marketplace `vspackage` URL, `gunzip`, `unzip`, `grep -o 'phc_[A-Za-z0-9]*' extension/extension.js`):

   ```bash
   node -e '
   const KEY = process.argv[1];
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

6. Update this skill: delete this section and the combined-loader notes under Nightly.

## Gotchas index

- `bun run package` in `apps/vscode` does not build `@cline/*` workspace deps — fresh checkouts need `bun run build:sdk` first (the workflows handle this).
- Every ext workflow pins `bun-version: 1.3.14` while the root `packageManager` is `bun@1.3.13`. This is consistent across all of them and has shipped fine — don't "fix" it in one workflow alone.
- The publish job pins **Node 22** on purpose: Node 24 / npm 11 can make vsce's `npm list` detection fail with `ELSPROBLEMS` during packaging. `setup-bun` provides no Node runtime, and the publish scripts and `npx ovsx` need one.
- **Publish the prebuilt artifact (`vsce publish --packagePath`) from a short, fresh job, never a bare `vsce publish` from the source tree.** Evidence, not mechanism: the bare path (stable workflow) hung 5/5 on 4.1.18 (Sep 2026) while `--packagePath` publishes took 3–15s five times in a row (4.1.16–4.1.20). Facts established from logs + vsce source: the hung request was `OPTIONS /_apis/gallery` (azure-devops-node-api route discovery, the very first request, no body), so the VSIX bytes never left the runner; the timeout is typed-rest-client's fixed 180s socket timeout; the stable job ran the workspace-vendored vsce **3.9.2** (`bun run` puts `node_modules/.bin` first on PATH — the global 4.0.0 it installed was unused; the `tmp-<pid>-…` temp name in the log is 3.9.2's), not 4.0.0; the A/B path succeeded with both 3.9.2 (Sep 2) and 4.0.0 (Sep 17, 22). Client stack is otherwise identical (typed-rest-client 1.8.11, azure-devops-node-api 12.5.0, Node 22, same runner image, same PAT). Ruled out: artifact size/content, `main` entry size, manifest fields, vsce 4.0.0, input drift since June. Unknown: why the first request hangs from that job shape. The new workflow retries the publish up to 3× with `--skip-duplicate` (safe: vsce checks the listing first, and maps a 409 from the upload, to "already published" + exit 0; WITHOUT the flag a duplicate is an error, which would turn a landed-but-response-lost upload into a red run with no tag/release/Slack). Marketplace version timestamps lag the upload by ~13 min (validation), so a `vsce` timeout does not prove the upload failed — check the live version before doing anything manual.
- `gh run watch --exit-status` has returned exit 0 on a failed run. Always confirm with `gh run view <id> --json status,conclusion` before acting on a result.
- Job-level `if:` ref checks in workflow YAML are advisory (a dispatched branch runs its own copy of the file); the enforced boundary is each environment's deployment-branch policy in repo settings.
- Marketplace PATs (`VSCE_PAT`/`OVSX_PAT`) are only mounted into publish steps; no publish workflow has an untrusted trigger surface.
- Environment-approval runs left waiting don't time out quickly — they sit for days and block their tag's concurrency group.
- Open VSX has held a first-time publish in moderation before (logs say "Published", API 404s for hours). Verify with the API query rather than the log line.
