---
name: publish-extension
description: Use when releasing the Cline VS Code extension through the stable or nightly workflow. Guides version selection, changelog preparation, workflow dispatch, environment approvals, tagging, and post-publish verification.
---

# VS Code Extension Release

Use this skill when the user asks to release, publish, or ship the VS Code extension.

> Working directory: repository root. Dispatch both workflows from `main`.

## Release channels

| Channel | Marketplace ID | Workflow | Version |
|---|---|---|---|
| Stable | `saoudrizwan.claude-dev` | `ext-vscode-publish-stable.yml` | `apps/vscode/package.json`; tag `v<version>` must match |
| Nightly | `saoudrizwan.cline-nightly` | `ext-vscode-publish-nightly.yml` | `<major>.<minor>.<unix-ts>` derived from `apps/vscode/package.json` |

Both channels package the SDK-based extension from `main`. Stable and nightly run the reusable Bun test workflow before entering their publishing environment.

## Golden rules

1. **Marketplace versions only move forward.** Before a stable release, query the live listing and choose a strictly higher version:

   ```bash
   curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
     -H "Content-Type: application/json" -H "Accept: application/json;api-version=3.0-preview.1" \
     -d '{"filters":[{"criteria":[{"filterType":7,"value":"saoudrizwan.claude-dev"}]}],"flags":16}' \
     | python3 -c "import json,sys; v=json.load(sys.stdin)['results'][0]['extensions'][0]['versions'][0]; print(v['version'], v['lastUpdated'])"
   ```

2. **The tag, package version, and changelog heading agree.** Stable expects `v<package version>` and a leading `## [<version>]` changelog section.
3. **Test the exact commit you publish.** Dispatch stable and nightly from protected `main`; do not substitute an arbitrary build ref.
4. **Verify both registries.** A successful workflow log is not proof that Marketplace or Open VSX serves the version.
5. **Do not delete the `ext-sdk-bundle-rollout` PostHog flag yet.** Cline ≤4.1.17 embedded the retired loader and treats a missing flag as the old bundle. Keep the flag at 100% until activation traffic from those versions has ended. New builds do not read it.

## Stable release

### Prepare

1. Fetch `origin/main` and tags; verify the worktree is clean and based on current `origin/main`.
2. Query the Marketplace and Open VSX for the current version.
3. Update `apps/vscode/package.json` to the chosen version.
4. Add the release entry at the top of `CHANGELOG.md` using the existing format.
5. Run the extension checks relevant to the change, then commit and publish the preparation PR.

### Dispatch

After the preparation commit lands on `main`:

```bash
gh workflow run ext-vscode-publish-stable.yml \
  --ref main \
  -f release-type=release \
  -f auto_create_tag_from_main=true \
  -f tag=v<VERSION>
```

Use `release-type=pre-release` only when a real pre-release publication is intended. It is not a dry run.

The workflow tests `main`, waits for approval on the `publish` environment, pins the tested commit with the requested tag, installs with Bun, builds SDK dependencies, packages and publishes the extension, creates a GitHub release, and posts to Slack.

### Verify

```bash
gh run view <run-id> --json status,conclusion
git fetch --tags
git tag --list 'v<VERSION>'
gh release view v<VERSION>
curl -s "https://open-vsx.org/api/saoudrizwan/claude-dev" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['version'], d['timestamp'])"
```

Download the release artifact and verify:

- `extension/package.json` is `saoudrizwan.claude-dev@<VERSION>`.
- `extension/dist/extension.js` exists.
- `extension/legacy`, `extension/next`, and a root loader entrypoint do not exist.
- `process.env.TELEMETRY_SERVICE_API_KEY` does not remain as a literal in the bundle.

## Nightly release

Nightly is manual-only. The `PublishNightly` environment requires approval, so scheduled runs would wait and block later releases.

```bash
gh workflow run ext-vscode-publish-nightly.yml --ref main
gh workflow run ext-vscode-publish-nightly.yml --ref main -f dry-run=true
```

No changelog or version preparation is needed. The workflow packages the same extension as stable under the `cline-nightly` identity. A dry run builds and uploads the VSIX without publishing or tagging.

The tag step runs after publication and is best-effort because GitHub's default token cannot always create a tag whose commit changes workflow files. If publication succeeded but tagging failed, create the reported `nightly-main-<UTC timestamp>-<sha12>` tag with user credentials.

Verify the artifact has the same single-bundle layout as stable and query `saoudrizwan.cline-nightly` in both registries.

## Recovery

If a release is bad, fix `main` and publish a higher stable version through the normal workflow. Marketplace versions cannot be deleted or moved backward.

## Gotchas

- `bun run package` in `apps/vscode` does not build `@cline/*` workspace dependencies. Fresh checkouts need `bun run build:sdk` first; workflows already do this.
- Extension workflows pin Bun 1.3.14. Keep the workflows consistent rather than changing one release path in isolation.
- Publishing runs on Node 22. Newer Node/npm combinations can make vsce dependency detection fail even though Bun owns package installation and task execution.
- `gh run watch --exit-status` has returned exit 0 for failed runs. Confirm `status` and `conclusion` explicitly.
- Workflow ref checks are defense in depth. Repository environment deployment-branch policies enforce the publishing boundary.
- Marketplace credentials appear only in environment-gated publish steps.
- Open VSX can delay a first-time version after the publish command succeeds; verify with its API.