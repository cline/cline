---
name: publish-ui
description: Prepare, validate, and publish standalone @cline/ui npm releases. Use when bumping the UI package version, publishing latest or next through ui-publish.yml, checking UI release readiness, or completing the one-time npm trusted-publishing bootstrap.
---

# Publish UI

Release `@cline/ui` independently from the Cline SDK runtime packages.

## Release contract

- Version source: `sdk/packages/ui/package.json`.
- Workflow: `.github/workflows/ui-publish.yml`.
- The package keeps `internal: true` only to stay out of the SDK's shared
  version/publish scripts. It is still a public npm package because
  `private: false` and `publishConfig.access: public` control npm publication.
- `latest` is the production channel. `next` is an opt-in preview channel.
- There is no UI Git tag, GitHub release, schedule, or Slack announcement.
- PRs and pushes run UI quality checks but never publish. Publishing requires a
  manual workflow dispatch from `main` with `confirm_publish=publish`.
- Every npm publication needs a new semver version; npm versions are immutable.
- Always ask before pushing commits, triggering the publish workflow, changing
  npm trust settings, or running a local publish command.

## Normal release

1. Inspect the branch, current version, npm state, and UI changes.

```sh
sleep 1 && git status --short --branch
node -p "require('./sdk/packages/ui/package.json').version"
npm view @cline/ui dist-tags versions --json
sleep 1 && git log --oneline --no-merges -- \
  sdk/packages/ui apps/examples/desktop-app/webview/components/views/chat \
  .github/workflows/ui-publish.yml
```

2. Ask for patch, minor, major, or an explicit version. Do not guess. Update
   only `sdk/packages/ui/package.json` and its workspace version in `bun.lock`.
   Do not run the SDK version command.

3. Validate the release candidate.

```sh
bun install --filter @cline/ui --filter @cline/code --frozen-lockfile
bun -F @cline/ui typecheck
bun -F @cline/ui test
bun -F @cline/ui test:package
bun -F @cline/ui build-storybook
bun -F @cline/code test:chat-ui
```

The packed-package test installs the tarball in clean Bun and Node consumers.
Inspect `bun pm pack --dry-run` when the exported file set changed.

4. Commit the version bump separately from feature work. Ask before pushing.

```sh
sleep 1 && git add sdk/packages/ui/package.json bun.lock
sleep 1 && git commit -m "chore(ui): release vX.Y.Z"
sleep 1 && git push origin HEAD
```

5. After the release commit reaches `main`, ask which npm tag to use and ask
   for explicit publish approval. Then trigger and watch the standalone
   workflow:

```sh
run_url=$(gh workflow run ui-publish.yml --ref main \
  -f npm_tag=latest \
  -f confirm_publish=publish)
test -n "$run_url"
run_id=${run_url##*/}
gh run watch "$run_id" --exit-status
```

Use `npm_tag=next` only for a deliberate preview. Do not report success until
the workflow succeeds and npm shows the exact version under the selected tag.

```sh
npm view @cline/ui dist-tags versions --json
```

## One-time npm bootstrap

Use this only while `npm view @cline/ui` returns `E404`. npm requires the
package to exist before its GitHub trusted publisher can be configured.

1. Merge the package and `ui-publish.yml` to `main`. Start from a clean,
   reviewed `main` checkout. Verify authentication, account 2FA, and write
   access to the `@cline` npm organization. The `npm trust` command in step 4
   requires npm CLI 11.15 or newer; the automated trusted-publishing workflow
   itself enforces npm 11.5.1 or newer.

```sh
npm --version
npm whoami
npm view @cline/ui version
```

If npm is older than 11.15, ask before upgrading with
`npm install -g npm@^11.15.0`.

2. Build, test, and inspect the exact initial tarball. Record the absolute
   archive path printed by the final command.

```sh
bun -F @cline/ui test:package
pack_dir=$(mktemp -d)
(cd sdk/packages/ui && bun pm pack --destination "$pack_dir" --quiet)
tarball=$(find "$pack_dir" -maxdepth 1 -name '*.tgz' -print -quit)
test -n "$tarball"
tar -tzf "$tarball"
printf 'Bootstrap archive: %s\n' "$tarball"
```

3. Ask for explicit approval, then publish the initial version publicly under
   `latest`:

```sh
npm publish /absolute/path/from-step-2.tgz --access public --tag latest
```

4. Ask separately before configuring the standalone workflow as the trusted
   publisher:

```sh
npm trust github @cline/ui \
  --repo cline/cline \
  --file ui-publish.yml \
  --allow-publish
```

5. Verify both package state and trust. Every later release uses the workflow;
   do not add a long-lived npm token.

```sh
npm view @cline/ui dist-tags versions --json
npm trust list @cline/ui
```

## Final report

Report the version and npm tag, release commit, whether anything was pushed,
workflow URL or bootstrap result, npm verification, and tests/builds run. If
the package still returns `E404`, state that bootstrap remains required.
