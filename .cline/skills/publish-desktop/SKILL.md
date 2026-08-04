---
name: publish-desktop
description: Use when preparing, tagging, and publishing a Cline Code desktop app (apps/examples/desktop-app) release. Guides changelog drafting, version bumps in package.json + tauri.conf.json, desktop-vX.Y.Z tags, and the desktop-publish GitHub workflow that builds, signs, notarizes, and updates the auto-update feed.
---

# Desktop App Release

Use this skill when the user asks to release the desktop app, publish Cline Code, bump the desktop version, create a `desktop-vX.Y.Z` tag, or trigger the desktop publish workflow.

> Working directory: run every command below from the repository root.

Desktop releases are macOS-only today (signed + notarized DMG for Apple Silicon and Intel) and are built entirely in GitHub Actions — there is no local publish path. Installed apps discover new releases automatically through the Tauri updater, so publishing a release is what ships the update to every existing user.

## Release contract

- Version sources (must match each other and the tag): `apps/examples/desktop-app/package.json` and `apps/examples/desktop-app/src-tauri/tauri.conf.json`. (`src-tauri/Cargo.toml` has its own version but `tauri.conf.json` overrides it; no need to touch it.)
- Release tag: `desktop-vX.Y.Z`, where `X.Y.Z` matches both version files.
- Release prep includes approved release notes, the version bumps, and an `apps/examples/desktop-app/CHANGELOG.md` update.
- Publish path: `.github/workflows/desktop-publish.yml` (workflow_dispatch, requires the tag to exist, point at the checked-out commit, and be reachable from `origin/main`).
- The workflow creates the `desktop-vX.Y.Z` GitHub release (DMGs + updater artifacts + `latest.json`) and refreshes the rolling `desktop-latest` release, which is the static auto-update feed every installed app polls. Never delete the `desktop-latest` release or tag.
- The changelog's top `## X.Y.Z` section is extracted verbatim into the GitHub release body, the Slack announcement, and the updater manifest notes.
- Always ask before pushing commits or tags.

## Workflow

1. Gather context.

```sh
git status --short --branch
git fetch origin --tags
git tag --list 'desktop-v*' --sort=-v:refname | head -10
node -p "require('./apps/examples/desktop-app/package.json').version"
node -p "require('./apps/examples/desktop-app/src-tauri/tauri.conf.json').version"
```

If there is no `desktop-v*` tag yet, this is the first release; use the desktop app's first commit as the baseline and say the baseline is inferred.

2. Collect release commits.

```sh
git log <last-desktop-tag>..HEAD --oneline --no-merges -- apps/examples/desktop-app sdk/packages .github/workflows/desktop-publish.yml
```

The sidecar bundles `@cline/core` and friends from the monorepo, so SDK changes ship inside the desktop app too. Fold user-visible SDK changes (providers, models, behavior fixes) into the notes; skip purely internal ones.

3. Draft user-facing release notes.

Flat bullet list, user-facing language. Present the draft and wait for approval before editing files.

4. Decide the version bump.

Ask whether this is patch, minor, major, or an explicit version. Do not guess if the user has not made it clear.

5. Update release files.

- `apps/examples/desktop-app/package.json` → new version
- `apps/examples/desktop-app/src-tauri/tauri.conf.json` → same version
- Prepend `## X.Y.Z` (no date) to `apps/examples/desktop-app/CHANGELOG.md` with the approved notes.

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
git tag -a desktop-vX.Y.Z -m "Desktop vX.Y.Z"
git push origin refs/tags/desktop-vX.Y.Z
```

8. Publish.

The release commit must be on `main` and the tag pushed first.

```sh
gh workflow run desktop-publish.yml -f git_tag=desktop-vX.Y.Z -f confirm_publish=publish
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

Both matrix legs wait on the same environment, so one approval releases both.
Nothing after `validate` runs — and no signing key is readable — until then.

The workflow builds both architectures in parallel (aarch64 native, x86_64 cross-compiled), signs with the Developer ID certificate, notarizes with the App Store Connect API key, signs updater artifacts with the Tauri updater key, creates the GitHub release, refreshes `desktop-latest/latest.json`, and posts to Slack. Notarization typically adds 2–10 minutes.

If the workflow fails on missing credentials, see "Publish secrets (one-time setup)" below.

9. Verify the update feed after the run succeeds.

```sh
curl -sL https://github.com/cline/cline/releases/download/desktop-latest/latest.json | head -30
```

The `version` field must be the new release and both `darwin-aarch64` and `darwin-x86_64` URLs must point at the new `desktop-vX.Y.Z` assets. Installed apps pick the update up on next launch or within 2 hours.

10. Final response.

Report: version, tag, changelog updated, commit hash, what was pushed, workflow URL, and the feed verification result.

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
