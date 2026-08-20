---
name: publish-desktop
description: Use when preparing, tagging, and publishing a Cline desktop app (apps/examples/desktop-app) release — stable (desktop-vX.Y.Z from main) or beta (desktop-vX.Y.Z-beta.N from desktop-experimental, shipped as the side-by-side "Cline Beta" app). Guides changelog drafting, version bumps in package.json + tauri.conf.json, tagging, and the desktop-publish GitHub workflow that builds, signs, notarizes, and updates the per-channel auto-update feed.
---

# Desktop App Release

Use this skill when the user asks to release the desktop app, publish the Cline desktop app, cut a desktop beta, bump the desktop version, create a `desktop-vX.Y.Z` (or `desktop-vX.Y.Z-beta.N`) tag, or trigger the desktop publish workflow.

> Working directory: run every command below from the repository root.

Desktop releases are macOS-only today (a single signed + notarized universal DMG that runs natively on both Apple Silicon and Intel) and are built entirely in GitHub Actions — there is no local publish path. Installed apps discover new releases automatically through the Tauri updater, so publishing a release is what ships the update to every existing user **on that channel**.

## Release contract

- Two channels, one workflow (`channel` input on `desktop-publish.yml`):
  - **stable** — tag `desktop-vX.Y.Z` (no suffix; the workflow rejects prerelease suffixes on this channel), cut from `main`, feeds the rolling `desktop-latest` release, ships as "Cline".
  - **beta** — tag `desktop-vX.Y.Z-beta.N`, cut from `desktop-experimental`, feeds the rolling `desktop-beta` release, ships as "Cline Beta" (separate bundle identifier `bot.cline.app.beta`; installs side by side with stable). Built with the extra `src-tauri/tauri.beta.conf.json` overlay. Process background: `apps/examples/desktop-app/EXPERIMENTAL.md`.
- Version sources (must match each other and the tag): `apps/examples/desktop-app/package.json` and `apps/examples/desktop-app/src-tauri/tauri.conf.json`. (`src-tauri/Cargo.toml` has its own version but `tauri.conf.json` overrides it; no need to touch it.)
- Beta versions are prereleases of the **next** stable: stable `0.0.13` → betas `0.0.14-beta.1`, `-beta.2`, … Once a stable ≥ the beta base ships, the next beta bumps its base (`0.0.15-beta.1`).
- Release prep includes approved release notes, the version bumps, and an `apps/examples/desktop-app/CHANGELOG.md` update — committed on `main` for stable, on `desktop-experimental` for beta.
- Publish path: `.github/workflows/desktop-publish.yml` (workflow_dispatch, requires the tag to exist, point at the checked-out commit, and be reachable from the channel's branch — `origin/main` for stable, `origin/desktop-experimental` for beta).
- **Both channels dispatch from `main`.** This is a security invariant, not a convenience: the run executes `main`'s workflow copy and only the checkout points at the tag, so the signing-secret gates (the `github.ref == main` check and the PublishDesktop environment's main-only deployment-branch policy) hold for beta too. Never add `desktop-experimental` to the PublishDesktop deployment-branch policy.
- The workflow creates the tag's GitHub release (universal DMG + updater artifact + `latest.json`; marked prerelease for beta) and refreshes the channel's rolling feed release, which is the static auto-update feed every installed app on that channel polls. Never delete the `desktop-latest` or `desktop-beta` release or tag.
- The changelog's `## <version>` section (exact-match, not "topmost") is extracted verbatim into the GitHub release body, the Slack announcement, and the updater manifest notes.
- Always ask before pushing commits or tags.

## Workflow

0. Ask which channel this release is for — **stable or beta** — if the user has not said. Everything below branches on it; never guess.

1. Gather context.

```sh
git status --short --branch
git fetch origin --tags
git tag --list 'desktop-v*' --sort=-v:refname | head -10
node -p "require('./apps/examples/desktop-app/package.json').version"
node -p "require('./apps/examples/desktop-app/src-tauri/tauri.conf.json').version"
```

If there is no `desktop-v*` tag yet, this is the first release; use the desktop app's first commit as the baseline and say the baseline is inferred.

For a **beta** release, work on `desktop-experimental` (check out `origin/desktop-experimental`; merge `origin/main` into it first if it is behind — see EXPERIMENTAL.md for the conflict policy) and read the version files from that branch. The last-tag baseline is the newest `desktop-v*` tag of either channel that is an ancestor of the branch.

2. Collect release commits.

```sh
# stable (on main):
git log <last-desktop-tag>..HEAD --oneline --no-merges -- apps/examples/desktop-app sdk/packages .github/workflows/desktop-publish.yml
# beta (on desktop-experimental):
git log <last-desktop-tag>..origin/desktop-experimental --oneline --no-merges -- apps/examples/desktop-app sdk/packages .github/workflows/desktop-publish.yml
```

The sidecar bundles `@cline/core` and friends from the monorepo, so SDK changes ship inside the desktop app too. Fold user-visible SDK changes (providers, models, behavior fixes) into the notes; skip purely internal ones.

3. Draft user-facing release notes.

Flat bullet list, user-facing language. Present the draft and wait for approval before editing files.

4. Decide the version bump.

Stable: ask whether this is patch, minor, major, or an explicit version. Do not guess if the user has not made it clear.

Beta: apply the versioning rule — base = next stable version, increment `N` (`0.0.14-beta.1` → `0.0.14-beta.2`; after stable `0.0.14` ships, next is `0.0.15-beta.1`). Confirm the computed version with the user.

5. Update release files (on `main` for stable, on `desktop-experimental` for beta).

- `apps/examples/desktop-app/package.json` → new version
- `apps/examples/desktop-app/src-tauri/tauri.conf.json` → same version
- Prepend `## X.Y.Z` (no date; `## X.Y.Z-beta.N` for beta) to `apps/examples/desktop-app/CHANGELOG.md` with the approved notes.

6. Verify before committing.

```sh
bun -F @cline/code typecheck
bun test apps/examples/desktop-app/scripts/generate-update-manifest.test.ts
```

The full desktop bundle can only be built on macOS; the workflow's build job is the real verification. For extra local confidence on a Mac checkout, `bun run package:desktop:mac --allow-unsigned-mac` from the app directory.

7. Commit release changes.

```sh
git add apps/examples/desktop-app/package.json apps/examples/desktop-app/src-tauri/tauri.conf.json apps/examples/desktop-app/CHANGELOG.md
git commit -m "chore(desktop): release vX.Y.Z"
```

Ask before pushing the release commit, then before creating and pushing the tag:

```sh
git push origin HEAD
git tag -a desktop-vX.Y.Z -m "Desktop vX.Y.Z"       # beta: desktop-vX.Y.Z-beta.N / "Desktop vX.Y.Z-beta.N"
git push origin refs/tags/desktop-vX.Y.Z
```

8. Publish.

The release commit must be on the channel's branch (`main` for stable, `desktop-experimental` for beta) and the tag pushed first. Dispatch from `main` for **both** channels (see the release contract for why).

```sh
# stable:
gh workflow run desktop-publish.yml --ref main -f git_tag=desktop-vX.Y.Z -f channel=stable -f confirm_publish=publish
# beta:
gh workflow run desktop-publish.yml --ref main -f git_tag=desktop-vX.Y.Z-beta.N -f channel=beta -f confirm_publish=publish

gh run list --workflow=desktop-publish.yml --limit=1 --json url,status,conclusion,createdAt --jq '.[0]'
```

**The run pauses for approval.** `validate` runs immediately, then the `build`
job waits on the `PublishDesktop` environment until a required reviewer approves
it — the run sits in `waiting`, which is expected, not a hang. Approve it in the
run's web UI ("Review deployments"), or:

```sh
gh api repos/cline/cline/actions/runs/<run-id>/pending_deployments \
  --method POST -f state=approved -f comment="desktop vX.Y.Z" \
  -F 'environment_ids[]=19152605990'   # PublishDesktop
```

Nothing after `validate` runs — and no signing key is readable — until then.

The workflow builds one universal macOS bundle (`tauri build --target universal-apple-darwin` lipos the aarch64 + x86_64 Rust binaries; the Bun sidecar is lipo'd by `build-sidecar-bin.ts`; beta adds the `tauri.beta.conf.json` overlay), verifies every Mach-O in the bundle carries both slices and that the compiled binary embeds exactly its own channel's feed URL, signs with the Developer ID certificate, notarizes with the App Store Connect API key, signs the updater artifact with the Tauri updater key, creates the GitHub release (prerelease for beta), refreshes the channel's feed (`desktop-latest/latest.json` or `desktop-beta/latest.json`), and posts to Slack. Notarization typically adds 2–10 minutes.

If the workflow fails on missing credentials, see "Publish secrets (one-time setup)" below.

9. Verify the update feed after the run succeeds.

```sh
curl -sL https://github.com/cline/cline/releases/download/desktop-latest/latest.json | head -30   # stable
curl -sL https://github.com/cline/cline/releases/download/desktop-beta/latest.json | head -30    # beta
```

The `version` field must be the new release and both `darwin-aarch64` and `darwin-x86_64` entries must point at the same new universal `.app.tar.gz` asset under the release tag (each slice of the fat binary requests its own arch key at runtime, so both keys serve the one artifact). Installed apps on that channel — including older per-arch installs — pick the update up on next launch or within 2 hours.

After a **beta** publish, also confirm the stable feed was not touched: `desktop-latest/latest.json` must still serve the previous stable version. (The workflow guards this fail-closed, but it is cheap to verify and catastrophic to miss — the updater comparator is a plain semver "newer than", so a beta manifest on `desktop-latest` would auto-update every stable install onto the beta.)

10. Final response.

Report: channel, version, tag, changelog updated, commit hash, what was pushed, workflow URL, and the feed verification result.

## Publish secrets (one-time setup)

These live on the **`PublishDesktop` environment**, not at repository level, so
only the `build` job can read them and only after an approval. Set them under
Settings → Environments → PublishDesktop → Environment secrets. The environment
also restricts deployments to `main` and requires a reviewer.

Adding one of these as a *repository* secret is the common mistake. The build
would still succeed — an environment-gated job resolves repository secrets too,
with environment values simply taking precedence — so the credential would sit
repo-wide while everything looked fine. `validate` therefore fails the run if any
of them resolves in a job with no environment. If you hit that, delete the
repository-level copy rather than duplicating it.

If a secret is missing everywhere, the preflight in `build` fails the run naming
the missing entries. The Apple values come from the same Apple Developer account
used for manual signing (see the app README's "macOS signing & notarization"
section for how to obtain them):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of the **Developer ID Application** identity exported from Keychain Access as `.p12` (must include the private key): `base64 -i certificate.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Team Name> (<TEAMID>)` — from `security find-identity -v -p codesigning` |
| `APPLE_API_KEY` | App Store Connect API **Key ID** (notarization) |
| `APPLE_API_KEY_CONTENT` | Contents of the `AuthKey_<KEYID>.p8` file |
| `APPLE_API_ISSUER` | App Store Connect **Issuer ID** (UUID from Users and Access → Integrations) |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the Tauri updater private key (`tauri signer generate`). If this key is ever lost, shipped apps can no longer verify updates — guard it. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for that key |

The Slack + telemetry secrets (`SLACK_RELEASE_BOT_TOKEN`, `TELEMETRY_SERVICE_API_KEY`,
`ERROR_SERVICE_API_KEY`, OTEL settings) are shared with the CLI, SDK, and extension
publish workflows and already configured. **Do not move these into
`PublishDesktop`** — scoping them to this environment empties them in every other
publish workflow, silently, with no error beyond missing telemetry and a failed
Slack post.
