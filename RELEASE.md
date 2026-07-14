# Release Checklist — AI-Hydro VS Code Extension

Part of the ecosystem remediation plan, item 3.3. Written because no
`v0.x.x`-style tag exists for any AI-Hydro release to date — all 303 tags in
this repo's history are inherited from the upstream Cline fork (`v2.x`,
`v3.x`), none reflect this project's own `0.x.x` version line. Without a tag,
"what commit shipped as 0.2.5" can only be reconstructed from `CHANGELOG.md`
dates, not verified directly against git history.

## The invariant

**tag == `package.json` version == marketplace-published version**, always.
If any two of these disagree, that is a release-hygiene bug to fix before
the next release, not a state to work around.

## Tag naming

Use `aihydro-v{version}` (e.g. `aihydro-v0.2.5`), **not** a bare `v{version}`
tag — the bare `vN.N.N` namespace is already occupied by 303 inherited
upstream Cline tags in this repo's history, and a bare `v0.2.5` would be
ambiguous against that inherited series if upstream ever reaches a `0.x`
version again (unlikely, but the distinct prefix costs nothing and removes
the ambiguity entirely).

## Checklist

1. **Bump `package.json`** `version` field. Confirm no other file hardcodes
   the old version (`grep -rn "<old-version>"` across `README.md`,
   `CHANGELOG.md`, this repo's own docs).
2. **Add a `CHANGELOG.md` entry** dated to the release, following the
   existing Keep-a-Changelog format already used in this file.
3. **Remove any `.vsix` build artifacts** from the working tree before
   committing — they're gitignored (`*.vsix` in `.gitignore`) but stray
   local builds should not be left lying around; `rm -f *.vsix` before the
   release commit.
4. **Commit** the version bump + changelog entry.
5. **Tag** the release commit: `git tag aihydro-v{version}` (annotated:
   `git tag -a aihydro-v{version} -m "..."` preferred for a real release).
6. **Push** the commit and tag together: `git push && git push --tags`
   (or `git push --follow-tags`) — only after the above are verified locally;
   pushing is not part of this checklist's automatic scope, confirm with the
   maintainer before pushing a tag that becomes part of shared history.
7. **Publish to the marketplace** (VS Code Marketplace / Open VSX, whichever
   applies) using the exact same version number as the tag and
   `package.json`. If the publish step produces its own artifact version
   string, verify it matches before considering the release done.
8. **Update `PROJECT.md`** (ecosystem root) if it references the extension
   version anywhere — see the ecosystem `docs/generated/ecosystem_status.md`
   generator (`scripts/ecosystem_status.py`), which already reads
   `package.json` live for this purpose; prefer pointing at that generated
   file over hand-typing the version a second time.

## Baseline established (2026-07-08)

No prior release has a tag. `aihydro-v0.2.5` was tagged retroactively at
the current `main` HEAD as of this remediation pass, so future releases have
a real predecessor to diff against. This does **not** claim that HEAD is
byte-identical to whatever was actually published as 0.2.5 historically —
only that it's the closest available anchor point, and every release from
here forward will have an accurate tag.
