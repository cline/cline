# Hotfix Release

Prepare an expedited VS Code extension release from `main`.

The stable publisher builds only the exact `main` commit that its test job checks. It does not publish an arbitrary tag or a release branch. A hotfix therefore includes every change that has landed on `main`; do not create a detached tag with selected cherry-picks.

## Step 1: Confirm the fix on main

Sync `main` and identify the fix commits:

```bash
git checkout main
git pull origin main
git log --oneline -20
node -p 'require("./apps/vscode/package.json").version'
```

Confirm that each required fix has landed and passed its PR checks. If a fix has not landed, prepare and merge its focused PR before continuing.

## Step 2: Choose the version

Query the live Marketplace version and choose a higher patch version:

```bash
curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
  -H "Content-Type: application/json" -H "Accept: application/json;api-version=3.0-preview.1" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"saoudrizwan.claude-dev"}]}],"flags":16}' \
  | python3 -c "import json,sys; v=json.load(sys.stdin)['results'][0]['extensions'][0]['versions'][0]; print(v['version'], v['lastUpdated'])"
```

Ask the maintainer to confirm the new version.

## Step 3: Prepare the release PR

Create a branch from current `main`, then:

1. Add a `## [<version>]` section at the top of `CHANGELOG.md` with concise descriptions of the fixes.
2. Set `apps/vscode/package.json` to the same version.
3. Run the checks relevant to the included fixes.

No dependency install is needed for a changelog and version-only change. `bun.lock` does not pin workspace package versions.

```bash
VERSION=$(node -p 'require("./apps/vscode/package.json").version')
git switch -c "dpc/release-v${VERSION}"
git add CHANGELOG.md apps/vscode/package.json
git commit -m "chore(vscode): release v${VERSION}"
git push -u origin HEAD
```

Open the release-preparation PR and merge it after its checks pass. Do not push directly to protected `main` and do not create the release tag by hand.

## Step 4: Publish

After the release-preparation PR lands, follow `.clinerules/workflows/release.md` from its publish step. Dispatch `ext-vscode-publish.yml` from `main` with `<version>` and `publish=true`.

The workflow validates and tests the dispatch commit, publishes its prebuilt VSIX, then creates `v<version>` and the GitHub release.

## Step 5: Verify and announce

Verify the workflow conclusion, Marketplace version, Open VSX version, tag, and GitHub release as described in `.cline/skills/publish-extension/SKILL.md`.

Prepare the announcement from the fixes included in the release:

```text
VS Code Hotfix v<VERSION> Published

- Description of fix 1 https://github.com/cline/cline/pull/<PR_NUMBER>
- Description of fix 2 https://github.com/cline/cline/pull/<PR_NUMBER>
```
