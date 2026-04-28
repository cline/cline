---
name: publish-cli
description: Use when preparing, tagging, and publishing an apps/cli npm release. Guides changelog drafting, apps/cli/package.json version bumps, cli-vX.Y.Z tags, local npm publishing, and the publish-cli GitHub workflow.
---

# CLI Release

Use this skill when the user asks to release the CLI, publish `@clinebot/cli`, bump the CLI version, draft release notes, create a `cli-vX.Y.Z` tag, or trigger the CLI publish workflow.

The CLI is npm-only. Do not add alternate distribution or signing steps.

The skill should guide the user through one release preparation flow, then offer the publish path options. The two normal publish paths are GitHub Actions and local publishing from an authenticated machine.

## Release contract

- Version source: `apps/cli/package.json`.
- Main release tag: `cli-vX.Y.Z`, where `X.Y.Z` matches `apps/cli/package.json`.
- Nightly release version: `X.Y.Z-nightly.TIMESTAMP`.
- Release prep includes approved release notes, a version bump, and an `apps/cli/CHANGELOG.md` update.
- Publish paths:
  - GitHub workflow: `.github/workflows/publish-cli.yaml`.
  - Local publish helper: `bun release cli`.
- npm dist-tags and git tags are separate. `--tag latest` and `--tag nightly` are npm registry channels. `cli-vX.Y.Z` is a git tag for source history and GitHub releases.
- The GitHub main release workflow runs from `main`, requires an existing `cli-vX.Y.Z` tag, checks out that tag, and publishes from it.
- The GitHub nightly workflow publishes to npm with the `nightly` dist-tag and does not create a tag.
- The local release helper requires a clean checkout and `cli-vX.Y.Z` to point at `HEAD` locally and on `origin` before publishing.
- Local GitHub release creation requires `gh` to be authenticated with release permissions for the repo.
- Always ask before pushing commits or tags.
- Do not amend commits unless explicitly requested.

## Workflow

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
git log <last-cli-tag>..HEAD --oneline --no-merges -- apps/cli packages scripts .github/workflows/publish-cli.yaml
```

If the release includes broader SDK changes that affect the CLI, also inspect commits outside `apps/cli`.

3. Draft user-facing release notes.

Include user-facing features, fixes, behavior changes, compatibility changes, and notable install or release changes. Exclude pure refactors, tests, style, chores, and internal file moves unless they matter to users.

Write a flat bullet list. Translate commit messages into user-facing language. If a commit is unclear, read the full commit before summarizing it.

Present the draft and wait for approval before editing files.

4. Decide the version bump.

Ask whether this should be patch, minor, major, or an explicit version. Do not guess if the user has not made it clear.

5. Update release files.

Update `apps/cli/package.json` to the approved version.

Prepend a section to `apps/cli/CHANGELOG.md` for the approved version using the approved release notes.

6. Verify before committing.

Run focused checks first:

```sh
bun -F @clinebot/cli typecheck
bun -F @clinebot/cli test:unit
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
gh workflow run publish-cli.yaml -f publish_target=main -f git_tag=cli-vX.Y.Z -f confirm_publish=publish
gh run list --workflow=publish-cli.yaml --limit=1 --json url,status,conclusion,createdAt --jq '.[0]'
```

For GitHub nightly release:

```sh
gh workflow run publish-cli.yaml -f publish_target=nightly
```

For forced GitHub nightly release:

```sh
gh workflow run publish-cli.yaml -f publish_target=nightly -f force_nightly_publish=true
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
