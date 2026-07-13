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
4. In the background, evaluates the PostHog flags and caches the assignment
   **for the next window**. Flag changes never flip a live window.

If the next bundle throws during activation, the loader disposes whatever it
half-registered, pins this VSIX version back to legacy
(`cline.rollout.nextActivationFailedVersion`), reports a `fallback` telemetry
event, and activates legacy — a crashed rollout self-heals without a
marketplace re-publish. A new version gets to try next again.

## Cohort rules

- **Sticky and one-way.** `ext-sdk-bundle-rollout` (percentage flag) only ever
  promotes `legacy → next`. Dialing the percentage down stops *new*
  promotions but demotes nobody: tasks created on the SDK bundle are stored as
  SDK sessions the legacy bundle can't list, and credentials rotated there
  live in `providers.json` only — a silent demotion would look like data loss.
- **Kill-switch demotes.** `ext-sdk-bundle-killswitch` (boolean flag) moves
  everyone back to legacy on their next window, accepting the switch-back
  cost above. Emergency use only.
- Flags are evaluated against the same PostHog distinct id the extension's
  telemetry uses (machine id, mirroring `src/services/logging/distinctId.ts`),
  so cohort membership is correlatable with telemetry. Flag evaluation is
  always on (matching `FeatureFlagsService`); the loader's own
  `extension.rollout.bundle_activated` event respects the user's telemetry
  opt-out and VS Code's global telemetry switch.
- `CLINE_BUNDLE_OVERRIDE=next|legacy` (env var) forces a bundle for local dev
  and e2e, beating all flags.

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
- `views` / `viewsContainers` / `engines` **must be identical** in both
  manifests — they can't be gated at runtime, so divergence fails the build.
  Keep view IDs and container IDs in sync between the branches.

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

Local builds have no `TELEMETRY_SERVICE_API_KEY`, so the loader skips PostHog
entirely and everyone stays on legacy unless `CLINE_BUNDLE_OVERRIDE` is set.

CI: the `ext-vscode-ab-package` workflow (manual dispatch) builds both refs,
stitches, smoke-tests, uploads the `.vsix` artifact, and optionally publishes.

## Rollout runbook

1. Create both flags in PostHog **before** the first publish:
   `ext-sdk-bundle-rollout` at **0%**, `ext-sdk-bundle-killswitch` **off**.
2. Publish the combined VSIX (version above every previously published one).
   With the rollout at 0% this release is behaviorally identical to legacy for
   everyone — it only validates the loader plumbing in the wild. Watch
   `extension.rollout.bundle_activated`.
3. Dial `ext-sdk-bundle-rollout` up: 1% → 5% → 25% → 100%. Promotions apply on
   each machine's next window reload after its (hourly-ish) flag refresh.
   Compare cohorts by the `bundle` property on activation events.
4. Never dial the percentage *down* expecting users to move back — they won't
   (by design). Emergencies: flip `ext-sdk-bundle-killswitch` on.
5. When next reaches 100% and soaks, retire the loader: publish a plain SDK
   extension build and delete this package.

## Version numbering

The combined VSIX owns the marketplace version line and must always exceed the
last version published from either branch (legacy stable was 4.0.x → start at
4.1.0). The bundles' own `package.json` versions ride along inside their
subdirectories for provenance; the loader reports the combined version as
`loader_version`.
