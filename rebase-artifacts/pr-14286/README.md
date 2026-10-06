# PR #14286: completed rebase, blocked push

The three commits from `dpc/remove-legacy-loader` were rebased onto
`cd80a20e96481f5f5d413789f6847accf846487b` (the fetched `main` tip).
The resulting head is `758428bd8db0e12054b07f8b917355d7e625e7d0`.

Conflicts were limited to these retired workflows:

- `.github/workflows/ext-vscode-ab-package.yml`
- `.github/workflows/ext-vscode-publish-stable.yml`

Both deletions were retained: the only intervening change was upgrading their
Bun pins to 1.4.2. The surviving nightly workflow retains that upstream upgrade.
The remaining two commits applied unchanged, and `git range-diff` confirmed no
other substantive changes.

GitHub rejected both the backup push of the rebased history and the guarded
force-push to the PR branch:

```text
refusing to allow a GitHub App to create or update workflow
`.github/workflows/ext-vscode-publish-nightly.yml` without `workflows` permission
```

**The PR branch has not been updated.** This backup commit contains no workflow
changes; it preserves the completed rebase as a Git bundle and a mail-format
patch series. It must not be merged into the PR.

## Apply from a session with workflow-update permission

From a clone of `cline/cline` with a clean working tree:

```bash
git fetch origin main cline/m2v9t2t9 dpc/remove-legacy-loader
git show origin/cline/m2v9t2t9:rebase-artifacts/pr-14286/pr-14286-rebased.bundle > /tmp/pr-14286-rebased.bundle
git bundle verify /tmp/pr-14286-rebased.bundle
git fetch /tmp/pr-14286-rebased.bundle refs/backup/pr-14286-rebased
git switch -c pr-14286-rebased FETCH_HEAD
git push --force-with-lease=refs/heads/dpc/remove-legacy-loader:21d3081ab398f0db05d1e1bd99da1628aace53bc origin HEAD:refs/heads/dpc/remove-legacy-loader
```

The bundle requires the stated `main` commit to be present locally. If `main`
has advanced, rebase the restored branch again before pushing. The explicit
lease refuses to overwrite changes made to the PR since this work began.
`pr-14286-rebased.patch` is an alternative that can be applied with `git am`
on top of the stated base commit (commit hashes will differ).

## Validation of the rebased version

Linux, Bun 1.4.2, Node 24.21.0:

- `bun install --frozen-lockfile`: passed; lockfile unchanged.
- `bun run build:sdk`: passed.
- Extension, compatibility, and webview TypeScript checks: passed.
- Extension unit tests: 1,126 passed across 80 files.
- Webview tests: 532 passed across 70 files.
- SDK adapter/model-catalog Vitest tests: 1,306 passed across 95 files (93 files
  initially passed; two files passed on retry after code generation completed).
- `bun run build:production`: passed.
- `bun run publish:marketplace:nightly -- --dry-run`: passed, producing a 38-file
  VSIX with `main: ./dist/extension.js`, nightly identity, and no root loader or
  `legacy/` / `next/` directories. Manifest, README, backup files, and temporary
  workspace link were restored; working tree was clean afterward.
- Changed-script JavaScript syntax, publisher help/no-credential paths, changed
  telemetry/publisher lint, nightly YAML parsing, Bun pin, and `git diff --check`:
  passed.

Some initial checks overlapped code generation and failed on missing generated
modules; all passed on retry after generation completed. A separate formatter
check noted an extra blank line already present in the original PR's nightly
publisher; it was left unchanged to keep this task scoped to the rebase.

No extension was published and no release workflow was dispatched.