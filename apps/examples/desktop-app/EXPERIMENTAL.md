# Desktop Experimental Branch & Beta Channel

How experimental desktop features are developed on the `desktop-experimental`
branch, shipped to users as **Cline Code Beta**, and graduated into `main`.
The release mechanics (workflow internals, secrets) live in
[`.github/workflows/desktop-publish.yml`](../../../.github/workflows/desktop-publish.yml)
and the `publish-desktop` skill
([`.cline/skills/publish-desktop/SKILL.md`](../../../.cline/skills/publish-desktop/SKILL.md));
this doc is the process.

## What the beta channel is

The beta is a **separate app**, not a mode of the stable app:

- Product name `Cline Code Beta`, bundle identifier `bot.cline.app.beta`
  (stable is `Cline Code` / `bot.cline.app`) — set by
  [`src-tauri/tauri.beta.conf.json`](./src-tauri/tauri.beta.conf.json), which
  is layered over `tauri.release.conf.json` at build time.
- Both apps install and run **side by side**, so people can compare beta
  features against stable directly.
- Each channel polls its own auto-update feed: stable installs poll the
  rolling `desktop-latest` release, beta installs poll the rolling
  `desktop-beta` release. The feed URL is compiled into the binary, so a beta
  install only ever receives beta builds and vice versa. **Never delete either
  rolling release.**
- Yes, the names are asymmetric: `desktop-latest` *is* the stable feed. Do
  not rename it to `desktop-stable` — the URL is baked into every stable
  binary ever shipped and the updater has no fallback endpoint, so renaming
  (or deleting) the release silently strands every existing install on a
  dead feed forever. Renaming would mean maintaining both feeds for as long
  as any pre-rename install exists, i.e. permanently. Same applies to
  `desktop-beta` once the first beta ships.
- Both apps share `~/.cline` (provider credentials, global settings, hub
  daemon — the hub is multi-client by design, same as running the CLI and the
  app together). A beta that requires a newer hub build can trigger the
  hub-update-required flow in the stable app or vice versa; that's expected
  version skew, not a bug in itself.

Users join the beta by downloading the beta DMG from its GitHub release
(announced on Slack). There is no auto-downgrade: leaving the beta means
deleting the beta app (stable was never touched). Beta users get the stable
version of a graduated feature through the normal stable release of the
stable app they still have installed.

## Branch model

`desktop-experimental` is a long-lived branch where experimental features
bake before graduating to `main`.

- **Feature PRs target `desktop-experimental`** and are merged there to
  iterate. Keep the feature's original PR against `main` open **as a draft**
  — it accumulates the follow-up work done on the experimental branch and
  documents intent to graduate.
- **Graduation** = a fresh (or the updated draft) PR against `main`
  containing the feature plus everything learned on the experimental branch.
  Treat it as a normal `main` PR: full review, tests, no experimental
  scaffolding.
- **Sync direction is one-way**: merge `main` into `desktop-experimental`
  regularly — at minimum after every stable desktop release — so the branch
  never drifts far. Never merge `desktop-experimental` into `main` wholesale.
- **Merge-conflict policy** when syncing `main` in:
  - `package.json` / `src-tauri/tauri.conf.json` versions: keep the branch's
    beta version (see versioning rule below for when to bump its base).
  - `CHANGELOG.md`: keep both sides' sections, newest version first — stable
    and beta sections interleave by recency.
  - Feature code: main wins for anything that graduated; resolve toward
    main's reviewed form.

## Versioning & tags

- Beta versions are prereleases of the **next** stable version: stable
  `0.0.13` → betas `0.0.14-beta.1`, `0.0.14-beta.2`, …
- Tag format: `desktop-vX.Y.Z-beta.N`, tagged on a `desktop-experimental`
  commit. Stable tags (`desktop-vX.Y.Z`, no suffix) stay on `main`; the
  workflow enforces both shapes and each channel's branch ancestry.
- When a stable release ships with a version ≥ the current beta base, bump
  the base for the next beta (stable `0.0.14` out → next beta is
  `0.0.15-beta.1`). A beta must never share its `X.Y.Z` base with an
  already-shipped stable.
- Semver keeps the channels ordered: `0.0.14-beta.N` sorts above stable
  `0.0.13` and below the eventual `0.0.14`.

## Cutting a beta release

Manual, like stable — no nightly automation. Short form (the
`publish-desktop` skill walks through it):

1. On `desktop-experimental`: merge `main` in, bump both version files to the
   new beta version, prepend a `## X.Y.Z-beta.N` section to `CHANGELOG.md`,
   commit, push.
2. Tag `desktop-vX.Y.Z-beta.N` on that commit and push the tag.
3. Dispatch **from `main`** with the beta channel:

   ```sh
   gh workflow run desktop-publish.yml --ref main \
     -f git_tag=desktop-vX.Y.Z-beta.N \
     -f channel=beta \
     -f confirm_publish=publish
   ```

4. Approve the `PublishDesktop` environment gate; the workflow builds, signs,
   and notarizes the beta bundle, creates a **prerelease** GitHub release,
   refreshes `desktop-beta/latest.json`, and posts to Slack — same
   announcement path as stable, marked as beta.

**Why dispatch from `main` when the code is on `desktop-experimental`?**
Security invariant: the workflow run executes `main`'s copy of
`desktop-publish.yml` and only the *checkout* points at the beta tag (the
`validate` job pins the tag to `desktop-experimental` ancestry). The
signing-secret gates — the `github.ref == main` check and the
`PublishDesktop` environment's main-only deployment-branch policy — stay
exactly as they are for stable, and a workflow file edited on
`desktop-experimental` can never reach the signing secrets. Do **not** add
`desktop-experimental` to the PublishDesktop deployment-branch policy.

One thing dispatch-from-main does *not* cover: the build job checks out the
tag and runs its build scripts (dependency install hooks, `build:sdk`,
Tauri's `beforeBuildCommand`, `build.rs`) with the signing secrets in scope
— true for stable and beta alike. The control is the PublishDesktop
required-reviewer approval: **approving a publish means vouching for the
code the tag points at**, not just for the release happening. That is why
`desktop-experimental` must keep main-grade merge controls (branch
protection, maintainer-only pushes) — anyone who can land code there can get
it executed alongside the signing keys once a publish of it is approved.

## Guardrails worth knowing about

- The updater comparator is a plain semver "newer than". Feed separation is
  the entire safety story: a beta manifest on `desktop-latest` would
  auto-update every stable install onto the beta. The workflow guards this
  three ways: the stable channel rejects prerelease tags, the feed target is
  derived fail-closed from the channel (and cross-checked in the release
  job), and the build asserts the compiled binary embeds exactly its own
  channel's feed URL before anything is signed into a release.
- `tauri.beta.conf.json` must exist on the tagged commit (the build checks
  out the tag), so keep it present on both `main` and `desktop-experimental`.
