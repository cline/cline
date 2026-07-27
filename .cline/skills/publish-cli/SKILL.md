---
name: publish-cli
description: Use when preparing, tagging, and publishing an apps/cli npm release. Guides changelog drafting, apps/cli/package.json version bumps, cli-vX.Y.Z tags, local npm publishing, and the publish-cli GitHub workflow.
---

# CLI Release

Use this skill when the user asks to release the CLI, publish `cline`, bump the CLI version, draft release notes, create a `cli-vX.Y.Z` tag, or trigger the CLI publish workflow.

The CLI is npm-only. Do not add alternate distribution or signing steps.

> Working directory: run every command below from the repository root. Paths and scripts (e.g. `apps/cli/package.json`, `sdk/packages/`, `bun release cli`, `bun run version`) are written relative to the repo root.

The skill should guide the user through one release preparation flow, then offer the publish path options. The two normal publish paths are GitHub Actions and local publishing from an authenticated machine.

## Release contract

- SDK prerequisite: the CLI depends on the SDK via `workspace:*` (`@cline/core`, `@cline/shared`, and friends). If the SDK changed since its last release, release the SDK first and wait for it to finish publishing before releasing the CLI. See "Step 0: Release the SDK first if it changed" below.
- Version source: `apps/cli/package.json`.
- Main release tag: `cli-vX.Y.Z`, where `X.Y.Z` matches `apps/cli/package.json`.
- Nightly release version: `X.Y.Z-nightly.TIMESTAMP`.
- Release prep includes approved release notes, a version bump, and an `apps/cli/CHANGELOG.md` update.
- Publish paths:
  - GitHub workflow: `.github/workflows/cli-publish.yml`.
  - Local publish helper: `bun release cli`.
- npm dist-tags and git tags are separate. `--tag latest` and `--tag nightly` are npm registry channels. `cli-vX.Y.Z` is a git tag for source history and GitHub releases.
- The GitHub main release workflow runs from `main`, requires an existing `cli-vX.Y.Z` tag, checks out that tag, and publishes from it.
- The GitHub nightly workflow publishes to npm with the `nightly` dist-tag and does not create a tag.
- The local release helper requires a clean checkout and `cli-vX.Y.Z` to point at `HEAD` locally and on `origin` before publishing.
- Local GitHub release creation requires `gh` to be authenticated with release permissions for the repo.
- Always ask before pushing commits or tags.
- Do not amend commits unless explicitly requested.

## Step 0: Release the SDK first if it changed

Do this before anything else in the Workflow below.

The CLI builds and ships against the SDK source in the monorepo (`workspace:*` for `@cline/core`, `@cline/shared`, and the rest), so a CLI release always contains the latest SDK code whether or not the SDK was released. The build and tests use that source too, not anything from npm. Releasing the SDK alongside the CLI is still worth doing for two reasons:

- Hub freshness. The hub daemon lives in `@cline/core` and stamps a `buildId` that defaults to the `@cline/core` package version (`resolveHubBuildId` in `sdk/packages/core/src/hub/discovery/index.ts`). A running hub is only retired and respawned when that `buildId` changes (`isCompatibleHubRecord` / `retireIncompatibleHub` in `sdk/packages/core/src/hub/daemon/index.ts`). So if the SDK code changed but the version did not, a user who upgrades the CLI keeps talking to their already-running hub, which is still executing the old SDK code. Bumping the SDK version makes the new CLI's `buildId` differ, so the stale hub is detected as incompatible and respawned with the fresh code.
- Release hygiene. We want regular SDK releases; cutting one whenever we cut a CLI release keeps the published SDK in step with what the CLI ships.

So when the SDK has changed, release it first (which bumps the `@cline/core` version), then cut the CLI release on top of that bump. Leave the CLI's SDK dependency as `workspace:*` — the fix is to release the SDK, not to pin the CLI.

1. Check for unreleased SDK changes.

```sh
git fetch origin --tags
git tag --list 'sdk/sdk/v*' 'sdk-v*' --sort=-v:refname | head -1
git log <last-sdk-tag>..origin/main --oneline --no-merges -- sdk/packages
```

`sdk/<pkg>/v*` tags are created by the `sdk-publish.yml` workflow; `sdk-v*` tags are created by the local `bun release sdk` helper. Use whichever is newest as the baseline.

If `git log` prints no commits, the SDK is already up to date. Skip the rest of Step 0 and continue with the Workflow below.

If it prints commits, sanity-check the diff (ignore entries that are only the previous version-bump commit's lockfile or generated files), then release the SDK.

2. Decide the SDK version bump.

All SDK packages share one version, read from `sdk/packages/llms/package.json`. Ask whether this is patch, minor, major, or an explicit version. Patch is the default. Do not guess if the user has not made it clear.

3. Draft the SDK release notes and update the changelog.

Draft user-facing notes from the SDK commits found in step 1, translating commit messages into user-facing language (same approach as the CLI release notes below). Prepend a new `## <version>` section with those notes to the top of `sdk/CHANGELOG.md`, using the header format `## <version>` with no date — the same flat, newest-on-top format as `apps/cli/CHANGELOG.md`. This is the SDK changelog (all SDK packages share one version) and it is maintained by hand; the `sdk-publish.yml` workflow does not read it.

4. Bump versions and regenerate.

```sh
bun run version <version>
```

This bumps every SDK `package.json` to the new version, regenerates the lockfile and the generated model catalog, formats, and builds. Review the result.

5. Commit and push the bump to `main`.

The `sdk-publish.yml` workflow publishes the version that is committed on `main` and tags that commit, so the bump must land on `main` before the workflow runs.

```sh
git add -A
git commit -m "chore(sdk): release v<version>"
```

Ask before pushing:

```sh
git push origin HEAD
```

6. Trigger the SDK publish workflow on the `latest` channel.

```sh
gh workflow run sdk-publish.yml -f channel=latest -f confirm_publish=publish
gh run list --workflow=sdk-publish.yml --limit=1 --json databaseId,url,status,createdAt --jq '.[0]'
```

The workflow runs the SDK tests, publishes `@cline/shared`, `@cline/llms`, `@cline/agents`, `@cline/core`, and `@cline/sdk` to npm with the `latest` dist-tag in dependency order, and pushes `sdk/<pkg>/v<version>` git tags.

7. Wait for the SDK workflow to succeed before starting the CLI release.

```sh
gh run watch <run-id> --exit-status
```

Do not start the CLI release until this run has finished successfully. The CLI does not install the SDK from npm, but cutting the CLI release on top of a clean, completed SDK release keeps the two in step: the CLI release commit then sits on top of the `@cline/core` version bump, so the shipped CLI carries the new version that forces a running hub to respawn with the new code, and you are not building a CLI release on top of an SDK release that failed midway.

After the SDK release succeeds, pull `main` so the CLI release is prepared on top of the SDK version bump:

```sh
git checkout main && git pull --ff-only
```

Then continue with the Workflow below.

For a local SDK publish from an authenticated machine instead of the workflow, `bun release sdk <version>` exists, but prefer the `sdk-publish.yml` workflow for normal releases so the CLI release can gate on a single GitHub Actions run.

## Workflow

Complete Step 0 first. Only proceed once the SDK is released (or you confirmed no SDK release was needed).

1. Gather context.

```sh
git status --short --branch
git fetch origin --tags
git tag --list 'cli-v*' --sort=-v:refname | head -10
node -p "require('./apps/cli/package.json').version"
```

Find the latest CLI tag. If there is no `cli-v*` tag, use the first relevant CLI release commit as the baseline and say that the baseline is inferred.

2. Collect release commits.

```sh
git log <last-cli-tag>..HEAD --oneline --no-merges -- apps/cli sdk/packages sdk/scripts .github/workflows/cli-publish.yml
```

The `sdk/packages` commits matter here even though the SDK was released separately in Step 0: the CLI bundles the SDK, so SDK changes ship in this CLI release too. Read those commits and fold anything user-relevant to the CLI into the release notes (provider/model updates, behavior changes, fixes the CLI inherits). Skip SDK changes that are purely internal or have no CLI-visible effect.

3. Draft user-facing release notes.

Include user-facing features, fixes, behavior changes, compatibility changes, and notable install or release changes. Exclude pure refactors, tests, style, chores, and internal file moves unless they matter to users.

Write a flat bullet list. Translate commit messages into user-facing language. If a commit is unclear, read the full commit before summarizing it.

Present the draft and wait for approval before editing files.

4. Decide the version bump.

Ask whether this should be patch, minor, major, or an explicit version. Do not guess if the user has not made it clear.

5. Update release files.

Update `apps/cli/package.json` to the approved version.

Prepend a section to `apps/cli/CHANGELOG.md` for the approved version using the approved release notes. Use the header format `## X.Y.Z` with no date. The publish workflow extracts the top section of the changelog by matching `^## [0-9]` and pastes it verbatim into the GitHub release body and the Slack release announcement, so the section content is the release notes that get shipped.

6. Verify before committing.

Run focused checks first:

```sh
bun -F @cline/cli typecheck
bun -F @cline/cli test:unit
```

For higher confidence, run:

```sh
bun run types
bun --cwd apps/cli run build:platforms:single
```

If the user wants full release confidence before tagging, run:

```sh
bun run test
bun --cwd apps/cli run build:platforms
```

Known local-only test failure: `src/commands/distribution-package.test.ts > rejects direct source package packing by default` will fail on machines that have `ignore-scripts=true` in `~/.npmrc` (set by the npm supply-chain hardening guide). Bun reads npm's `ignore-scripts` from `~/.npmrc`, so `bun pm pack --dry-run` skips the source-publish `prepack` guard and exits 0, which the test reads as a failure. CI does not set `ignore-scripts`, so the test passes there. Confirm by running `bun pm pack --dry-run` directly: with `~/.npmrc` in place it exits 0 with no guard output; with `~/.npmrc` moved aside it exits 1 and prints the guard message. This is not a release blocker by itself, but it does mean the local-publish path (`bun release cli`) will also bypass the source-publish guard on this machine; prefer the GitHub Actions publish path on machines with `ignore-scripts=true` set globally, or temporarily unset it (`npm config delete ignore-scripts` or `mv ~/.npmrc ~/.npmrc.bak`) for the duration of a local publish.

7. Commit release changes.

Only after the user approves the notes and version:

```sh
git add apps/cli/package.json apps/cli/CHANGELOG.md
git commit -m "chore(cli): release vX.Y.Z"
```

Ask before pushing the release commit:

```sh
git push origin HEAD
```

For the GitHub main release path, ask before creating and pushing the release tag:

```sh
git tag -a cli-vX.Y.Z -m "CLI vX.Y.Z"
git push origin refs/tags/cli-vX.Y.Z
```

8. Publish.

Ask the user which path to use:

- GitHub main release. Use this after the release commit is on `main` and the matching `cli-vX.Y.Z` tag has been pushed. The workflow publishes to npm from that tag, creates the GitHub release, and posts to Slack.
- Local release. Use this when the user wants to publish from this machine. The local machine must be authenticated to npm and GitHub.
- GitHub nightly release.
- Stop after the version commit.

For GitHub main release:

```sh
gh workflow run cli-publish.yml -f publish_target=main -f git_tag=cli-vX.Y.Z -f confirm_publish=publish
gh run list --workflow=cli-publish.yml --limit=1 --json url,status,conclusion,createdAt --jq '.[0]'
```

For GitHub nightly release:

```sh
gh workflow run cli-publish.yml -f publish_target=nightly
```

For forced GitHub nightly release:

```sh
gh workflow run cli-publish.yml -f publish_target=nightly -f force_nightly_publish=true
```

For local publish:

```sh
gh auth status
npm whoami
git tag -a cli-vX.Y.Z -m "CLI vX.Y.Z"
git push origin refs/tags/cli-vX.Y.Z
bun release cli
```

After a successful local publish, ask before running:

```sh
gh release create cli-vX.Y.Z --verify-tag --title "CLI vX.Y.Z" --notes "Paste the approved release notes here."
```

If publishing with another npm dist-tag:

```sh
bun release cli --tag next
```

9. Final response.

Report:

- version
- tag
- changelog file updated
- commit hash
- whether anything was pushed
- publish path selected
- workflow URL or local publish result
- tests and builds run
