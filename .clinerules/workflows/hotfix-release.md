# Hotfix Release

Create a hotfix release by cherry-picking specific commits from main onto the latest release tag.

## Overview

This workflow helps you:
1. Select specific commits from main to include in a hotfix
2. Create a release notes commit on main (changelog + version bump)
3. Cherry-pick everything onto the latest release tag
4. Tag and push the new release

## Step 1: Setup and Gather Information

First, ensure we're on main and up to date:

```bash
git checkout main && git pull origin main
```

Get the latest release tag:

```bash
git tag --sort=-v:refname | head -1
```

## Step 2: Present Commits Since Last Release

Show all commits on main since the last release tag:

```bash
LAST_TAG=$(git tag --sort=-v:refname | head -1)
git log ${LAST_TAG}..HEAD --oneline --format="%h %s (%an)"
```

Also get the commit messages already on the tag (to identify previously cherry-picked commits). Note: Run these as separate commands to avoid shell parsing issues with parentheses in author names:

```bash
LAST_TAG=$(git tag --sort=-v:refname | head -1)
PREV_TAG=$(git tag --sort=-v:refname | head -2 | tail -1)
```

```bash
git log $PREV_TAG..$LAST_TAG --oneline --format="%s"
```

**Present the list** to the user in a numbered format with commit hash, subject, and author. For any commits whose subject line already appears in the tag's history (previously cherry-picked in an earlier hotfix) or are "Release Notes" commits, add `(already in previous hotfix)` or `(release notes - skip)` after them so the user knows to skip those.

Ask which commits to include in the hotfix.

Use the ask_followup_question tool to let the user specify which commits they want (by number or hash).

## Step 3: Analyze Selected Commits

For each selected commit:
1. Get the full commit message: `git show --no-patch --format="%B" <hash>`
2. Get the diff to understand the change: `git show <hash> --stat`
3. Find the associated PR if any: `gh pr list --search "<hash>" --state merged --json number,title --jq '.[0]'`

Build a mental model of what these changes do for the changelog.

## Step 4: Determine New Version Number

Parse the current version from package.json and the last tag:

```bash
LAST_TAG=$(git tag --sort=-v:refname | head -1)
echo "Last release: $LAST_TAG"
cat package.json | grep '"version"'
```

Hotfixes always increment the patch version (e.g., 3.40.0 -> 3.40.1, or 3.40.1 -> 3.40.2).

**Ask the user to confirm the new version number.**

## Step 5: Create Release Notes Commit on Main

On the main branch, create a commit that updates:

1. **CHANGELOG.md** - Add a new section for the hotfix version at the top:
   ```markdown
   ## [3.40.1]

   - Description of fix 1
   - Description of fix 2
   ```

   Write clear, user-friendly descriptions based on your analysis of the commits.

2. **package.json** - Update the version field to the new version

3. **Delete changesets** for the commits being included in the hotfix. This prevents the changeset bot from including duplicate entries in the next regular release.

   Find and delete the changeset files associated with the selected commits:
   ```bash
   ls .changeset/
   ```

   Each changeset file in `.changeset/` corresponds to a PR. Read them to identify which ones belong to the commits you're hotfixing, then delete those files.

**Skip running `npm run install:all`** - the automation handles outdated lockfiles.

Commit with message format: `v{VERSION} Release Notes (hotfix)`

In the commit body, mention:
- This is for a hotfix release
- List the cherry-picked commits that will be included

```bash
git add CHANGELOG.md package.json .changeset/
git commit -m "v3.40.1 Release Notes (hotfix)

Hotfix release including:
- <commit1-hash>: <description>
- <commit2-hash>: <description>
"
```

Push to main:

```bash
git push origin main
```

## Step 6: Build the Hotfix on the Tag

Checkout the last release tag (detached HEAD):

```bash
LAST_TAG=$(git tag --sort=-v:refname | head -1)
git checkout $LAST_TAG
```

Cherry-pick the selected commits in order:

```bash
git cherry-pick <commit1-hash>
git cherry-pick <commit2-hash>
# ... etc
```

Finally, cherry-pick the release notes commit you just pushed to main:

```bash
# Get the hash of the release notes commit (should be HEAD of main)
RELEASE_NOTES_COMMIT=$(git rev-parse main)
git cherry-pick $RELEASE_NOTES_COMMIT
```

## Step 7: Tag and Push

After all cherry-picks are applied successfully:

```bash
# Tag the new release
git tag v{VERSION}

# Push the tag to remote
git push origin v{VERSION}
```

## Step 8: Return to Main and Summary

Return to main branch:

```bash
git checkout main
```

**Copy a Slack announcement message to clipboard** with the version and PR links for each included fix:

```
VS Code Hotfix v{VERSION} Published

- Description of fix 1 https://github.com/cline/cline/pull/{PR_NUMBER}
- Description of fix 2 https://github.com/cline/cline/pull/{PR_NUMBER}
```

Present a final summary:
- New version: v{VERSION}
- Tag pushed: yes
- Commits included: (list them)
- Slack message copied to clipboard: yes

Remind the user to:
1. Manually trigger the publish release GitHub Action at: https://github.com/cline/cline/actions/workflows/publish.yml (paste `v{VERSION}` as the tag)
2. Post the Slack message to announce the hotfix

## Important Notes

- This workflow does NOT create a release branch - only tags
- The release notes commit goes to main first, then gets cherry-picked to the tag
- This keeps main's history accurate while allowing hotfix releases from tags
- If cherry-pick conflicts occur, resolve them before continuing
