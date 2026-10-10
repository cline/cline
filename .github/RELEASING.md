# Coordinated stable releases

Run **Actions → publish-new-version → Run workflow**, using `main`. Choose an
independent `patch`, `minor`, or `major` bump for SDK, CLI, and Desktop; each
defaults to `patch`. Versions are calculated from the current manifests, not
entered manually. For example, `1.2.3` becomes `1.2.4`, `1.3.0`, or `2.0.0`.
Prerelease base versions are rejected; this flow is for stable releases.

The workflow opens one `bee/release-*` PR containing:

- A shared new version for all public SDK packages (internal UI packages keep
  their own version).
- The new CLI version and matching Desktop package/Tauri versions.
- An updated Bun lockfile, retaining workspace dependencies.
- Draft changelog sections from each product's scoped commits, including SDK
  changes in CLI and Desktop notes. When the current version has no tag, the
  draft includes all scoped history and needs extra editing.
- `.github/release-plan.json`, recording the base commit, old/new versions, and
  bump choices. This file is the reviewed release intent, not a generated tag.

Review the version changes, rewrite the draft changelogs into user-facing notes,
and include breaking changes and migration steps for major releases. Merge with
**squash or a merge commit** after CI succeeds. Rebase merging a multi-commit
release PR is unsupported because validation compares the release commit's first
parent with the recorded old versions. If another release changes a base version,
close the stale PR and prepare a fresh one.

The merge's push to `main` starts publication. The workflow checks that the exact
commit belongs to a merged, same-repository `bee/release-*` PR, validates its plan,
and atomically pushes the five `sdk/<package>/vX.Y.Z` tags, `cli-vX.Y.Z`, and
`desktop-vX.Y.Z`, all at that commit. Existing tags may be reused only if they point
at the same commit. It never moves tags.

The jobs call the existing publishers in order:

1. SDK tests and publication of shared → llms → agents → core → sdk.
2. CLI tests, platform builds, signing, and publication.
3. Desktop macOS/Windows builds, signing, and stable release/update feed publication.

All checkouts use the merged commit or its verified tags, even if `main` advances.
CLI and Desktop build SDK code from that checkout. The CLI npm wrapper also
requires those exact SDK versions to have been published. Desktop builds its own
sidecar; it does not download the newly published CLI package.

Desktop still waits for a reviewer on the **PublishDesktop** environment. Its
signing secrets and main-only deployment policy stay in place. The coordinator
runs on the push to `main` so CLI signing retains its existing branch-based Azure
OIDC identity. The standalone nightly/beta/manual publish paths remain available.
Do not run standalone stable releases concurrently with a coordinated release.

## One-time setup

- Merge these workflow changes to `main` before dispatching `publish-new-version`.
- In repository Actions settings, allow GitHub Actions to create pull requests.
  The preparation job uses `GITHUB_TOKEN` with `contents: write` and
  `pull-requests: write`; repository rules must permit its release branches and
  tags. Bot-created PR checks may require maintainer approval. Require the normal
  product checks and the release-plan check before merging a release PR. A human
  merge produces the push event that starts publishing; a merge performed with
  `GITHUB_TOKEN` will not trigger it.
- Add **`publish-new-version.yml`** as an additional npm trusted publisher for
  `cline`, all six `@cline/cli-*` platform packages, and `@cline/shared`,
  `@cline/llms`, `@cline/agents`, `@cline/core`, and `@cline/sdk`. Use organization
  `cline`, repository `cline`, and allow direct `npm publish`. Retain existing
  publisher entries for standalone and nightly releases. npm validates the
  **calling** workflow identity for reusable workflows; see
  [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
- Keep existing npm OIDC permissions, Azure signing configuration, and Desktop
  environment credentials/reviewers. No long-lived npm token is introduced.

## Recovery

A failed stage prevents later stages from running. Use **Re-run failed jobs** on
the original publication run, after resolving the failure. This keeps the same
release commit and versions. SDK and CLI publishing skip versions already on npm
so a partially published package set can finish. SDK registry errors other than
404 fail the run instead of being mistaken for missing packages. GitHub releases
can be updated on retry; announcements may be repeated if their steps rerun.

Do not prepare another release to recover a partially published one, move tags,
or rerun an older release after a newer release has shipped. npm versions cannot
be overwritten. If released code needs a fix, prepare a new version after the
current release has been resolved. Closing an unmerged preparation PR publishes
nothing and creates no release tags.

Local checks for this automation (no publishing):

```sh
bun test ./.github/scripts/release/plan.test.ts
```

## Local dry run

From the repository root, run:

```sh
bun run release:dry-run
# Choose independent bumps (all default to patch):
SDK_BUMP=minor CLI_BUMP=patch DESKTOP_BUMP=major bun run release:dry-run
```

The dry run copies local Git history, tracked working-tree changes, and unignored
untracked files into a temporary checkout with no configured remote. It uses the
same `prepare` and `validate` functions as the workflow, refreshes `bun.lock` with
`bun install --lockfile-only --ignore-scripts`, and validates a simulated release
commit in both PR and merged phases. Your source files, index, branches, and tags
are unchanged. It does not fetch tags; fetch current history beforehand if needed.
Lockfile resolution may need registry access, but requires no publishing credentials.

The printed temporary directory contains `release.patch`, `report.json` (version
bumps, planned tags, and publishing order), and the complete prepared `checkout/`.
Review the generated changelogs there. Remove the temporary directory when done;
it is retained on failure too for diagnosis.

For a partial rehearsal without lockfile resolution, use
`bun run release:dry-run --skip-lockfile`. The report explicitly records that skip.
This rehearsal does not create release tags or PRs, push, build/sign artifacts,
publish packages, or send announcements. GitHub permissions, PR provenance,
environment approvals, and publisher integration still require CI verification.
