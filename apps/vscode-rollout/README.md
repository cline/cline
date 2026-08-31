# vscode-rollout — A/B loader for the SDK extension rollout

The VS Code Marketplace has no staged rollouts: publishing a version updates
every user. This package lets us ship the **SDK-based extension** (main's
`apps/vscode`, "next") to a percentage of users while everyone else keeps
running the **legacy extension** (the `legacy-extension` branch), inside a
single published VSIX.

## How it works

The published VSIX contains a ~40 KB loader as its entrypoint and two complete,
independently built extension bundles:

```
extension.js          ← loader (this package)
package.json          ← UNION of both bundles' manifests (generated, see below)
assets/, walkthrough/ ← manifest-referenced resources (VSIX-root-relative)
next/                 ← SDK extension  (dist/, webview-ui/build/, assets/)
legacy/               ← legacy extension (dist/, webview-ui/build/, assets/, codicons)
```

Per window, the loader:

1. Reads the cached cohort assignment from its own `globalState` keys —
   synchronously, never from the network.
2. Sets the `cline.sdkBundle` context key (gates cohort-specific menu items /
   palette entries in the union manifest).
3. `require()`s exactly one bundle and calls its `activate()` with a
   Proxy-wrapped `ExtensionContext` whose `extensionUri` / `extensionPath` /
   `asAbsolutePath` point into that bundle's subdirectory — so each bundle
   resolves its own webview build and assets without knowing it was relocated.
   Storage properties pass through untouched: both bundles share the same
   `~/.cline/data` + VS Code storage they used as standalone extensions.
4. After the selected bundle activates, evaluates the PostHog flags in the
   background and caches the assignment **for the next window**. Flag changes
   never flip a live window. A crash fallback skips this refresh so it cannot
   overwrite the legacy pin.

If the next bundle throws during activation, the loader disposes whatever it
half-registered, pins this VSIX version back to legacy
(`cline.rollout.nextActivationFailedVersion`), reports a `fallback` telemetry
event, and activates legacy — a crashed rollout self-heals without a
marketplace re-publish. A new version gets to try next again.

## Cohort rules

- **Two-way, one knob.** `ext-sdk-bundle-rollout` (percentage flag) is the
  entire remote control surface: each background refresh caches exactly what
  the flag says for the machine's next window. Dialing the percentage up
  promotes; dialing it down demotes on the next reload — the emergency lever
  is simply "set the rollout to 0%". Known demotion costs (accepted): tasks
  created on the SDK bundle are stored as SDK sessions the legacy bundle
  doesn't list (they reappear on re-promotion — nothing is deleted), and
  credentials rotated on next may require a re-login on legacy.
- **The flag must stay a boolean flag.** The loader only promotes on a
  literal `true` from `/decide` — a multivariate variant, number, or anything
  else fails safe to legacy (see `parseRolloutAssignment` + tests). Don't
  convert it to multivariate.
- The flag is evaluated against the same PostHog distinct id the extension's
  telemetry uses (machine id, mirroring `src/services/logging/distinctId.ts`),
  so cohort membership is correlatable with telemetry. Flag evaluation is
  always on (matching `FeatureFlagsService`); the loader's own
  `extension.rollout.loader_decision` event respects the user's telemetry
  opt-out and VS Code's global telemetry switch.
- **Manual overrides, in either direction.** The `cline.rollout.bundleOverride`
  user setting (`"auto" | "next" | "legacy"`, editable straight from
  settings.json) forces a bundle for anyone — users in a pinch, or us
  debugging — beating the remote assignment both ways. Applies on window
  reload. `CLINE_BUNDLE_OVERRIDE=next|legacy` (env var) does the same for
  local dev and e2e and beats even the setting. Both are reported as
  `override` on the loader event so overridden machines don't pollute
  cohort comparisons.
- **Crash pinning is local, not remote.** If the next bundle throws during
  activation, the loader falls back to legacy in the same window and pins
  that VSIX version on this machine (`cline.rollout.nextActivationFailedVersion`);
  a new release gets to try next again. This safety net is independent of the
  flag.

## The union manifest

`package.json` contributions are static — VS Code reads them before any code
runs — so the shipped manifest must serve both cohorts. `scripts/gen-manifest.mjs`
regenerates it at stitch time from both branches' real manifests:

- Contributions declared by both bundles pass through untouched.
- Menu entries / keybindings declared by only one get `when` AND-ed with
  `cline.sdkBundle` / `!cline.sdkBundle`, so a cohort never sees a button its
  bundle didn't register (and shared buttons that moved position don't render
  twice).
- Commands exclusive to one bundle are hidden from the other cohort's command
  palette.
- `views` / `viewsContainers` / `configuration` / `walkthroughs`
  **must be identical** in both manifests — they can't be safely gated at
  runtime, so divergence fails the build. Keep these static contributions in
  sync between the branches. `engines` may diverge: the union takes the newer
  requirement (which necessarily satisfies the older one).

Because the manifest is regenerated from both branches on every build,
contribution drift between the branches can't ship silently — it either merges
cleanly or the stitch fails.

## Building locally

```bash
# 1. build both bundles (their own toolchains)
cd apps/vscode && bun run package                      # next
cd <legacy worktree>/apps/vscode && npm run package    # legacy (npm ci first)

# 2. build the loader + stitch + package
cd apps/vscode-rollout
bun run build                        # dev build; CI uses build:production with the PostHog key
node scripts/stitch.mjs \
  --next ../vscode --legacy <legacy worktree>/apps/vscode \
  --loader dist/extension.js --version 4.1.0 --out /tmp/cline-ab-staging
node scripts/smoke-loader.mjs /tmp/cline-ab-staging   # loader behavior smoke
cd /tmp/cline-ab-staging && vsce package --no-dependencies --allow-package-secrets sendgrid
```

The narrowly scoped `sendgrid` scanner exemption mirrors the existing next and
legacy packaging workflows. This workflow supplies only the existing PostHog
project-key inputs; it does not declare a SendGrid credential. Identify the
exact matching string in production staging output before changing or
broadening the exemption.

Local builds have no `TELEMETRY_SERVICE_API_KEY`, so the loader skips PostHog
entirely and everyone stays on legacy unless `CLINE_BUNDLE_OVERRIDE` is set.

CI: the `ext-vscode-ab-package` workflow (manual dispatch) builds both refs,
stitches, smoke-tests, uploads the `.vsix` artifact, and optionally publishes.

## Nightly channel

The daily `ext-vscode-publish-nightly` workflow (cron + manual dispatch)
publishes this same combined package as **`saoudrizwan.cline-nightly`**. Before
each bundle builds, `scripts/nightlify.mjs` rewrites its manifest to the
nightly identity — the same mutation the standalone nightly always applied
(`apps/vscode/scripts/publish-nightly.mjs` on both branches is the source of
truth), so nightly can be installed alongside stable:

| | stable | nightly |
|---|---|---|
| manifest `name` | `claude-dev` | `cline-nightly` |
| contribution IDs / context key / settings | `cline.*` | `cline-nightly.*` |
| version | operator-supplied (4.1.0+) | `<major>.<minor>.<unix-seconds>` |

The loader derives the namespace from its own `packageJSON.name` at runtime
(`idPrefix` in `src/cohort.ts`), and gen-manifest derives it from the next
manifest's name — no build flags involved. Nightly builds also show a
status-bar indicator (`Cline: Next` / `Cline: Legacy`); stable builds never do.

Dispatching the nightly workflow from `main` with `dry-run` builds and uploads
the installable `.vsix` without publishing or tagging. The publish job is
intentionally restricted to `main` by both the workflow and the
`PublishNightly` environment's deployment-branch policy.

### Telemetry events

- **`extension.rollout.bundle_activated`** (authoritative, captured by the
  activated bundle's own telemetry via its `reportRolloutActivation` export;
  requires the bundle to be built with `CLINE_ROLLOUT_VARIANT`): attempted vs
  actual bundle, fallback flag, error details on fallback. Every other event
  from a rollout build carries `extension_variant` as a common property.
- **`extension.rollout.loader_decision`** (loader-owned, direct capture): the
  loader-side metadata the bundle event can't know — override source, launch
  cadence, loader version, `extension_name` (nightly vs stable) — and the only
  signal when BOTH bundles fail (`double_failure: true`).

## Rollout runbook

Until the stable combined VSIX ships, the flag governs **nightly installs
only** — dialing it is safe for production users and is the lever for moving
nightly dogfooders onto next.

1. Create `ext-sdk-bundle-rollout` in PostHog **before** the first publish: a
   plain boolean release flag with a percentage rollout, starting at **0%**.
   (There is deliberately no kill-switch flag — the assignment is two-way, so
   0% *is* the kill switch.)
2. Publish the combined VSIX (version above every previously published one).
   With the rollout at 0% this release is behaviorally identical to legacy for
   everyone — it only validates the loader plumbing in the wild. Watch
   `extension.rollout.bundle_activated` and `extension.rollout.loader_decision`.
3. Dial `ext-sdk-bundle-rollout` up: 1% → 5% → 25% → 100%. Assignments apply on
   each machine's next window reload after its flag refresh, so propagation
   speed is bounded by how often people reload windows — watch the
   `ms_since_last_activation` distribution on loader events to see real
   uptake lag before deciding the next step, and compare cohorts by the
   `bundle` property.
4. Emergencies: dial the percentage **down** (0% pulls everyone back to legacy
   on their next reload). Demoted machines keep settings and creds; tasks
   created on the SDK bundle reappear when re-promoted. Ship the fix as a
   higher version, then dial back up. Machines whose next bundle *crashed*
   are additionally version-pinned to legacy locally, independent of the flag.
5. When next reaches 100% and soaks, retire the loader: publish a plain SDK
   extension build and delete this package.

## Version numbering

The combined VSIX owns the marketplace version line and must always exceed the
last version published from either branch (legacy stable was 4.0.x → start at
4.1.0). The bundles' own `package.json` versions ride along inside their
subdirectories for provenance; the loader reports the combined version as
`loader_version`.
