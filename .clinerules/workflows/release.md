# Release

Prepare and publish a release from the open changeset PR.

## Overview

This workflow helps you:
1. Find and checkout the open changeset PR
2. Clean up the changelog (fix version format, wordsmith entries)
3. Push changes back to the PR branch
4. Merge with proper commit message format
5. Tag and push the release (after verifying the commit)
6. Trigger the publish workflow
7. Update GitHub release notes
8. Provide final summary with Slack announcement

## Step 1: Find the Changeset PR

Look for the open changeset PR:

```bash
gh pr list --search "Changeset version bump" --state open --json number,title,headRefName,url
```

If no PR is found, inform the user there's no changeset PR ready. They may need to:
- Merge PRs with changesets to main first
- Manually trigger the Changeset Converter workflow at: https://github.com/cline/cline/actions/workflows/changeset-converter.yml

## Step 2: Gather PR Information

Get the PR details:

```bash
PR_NUMBER=<number from step 1>
gh pr view $PR_NUMBER --json body,files,headRefName
```

Checkout the PR branch:

```bash
git fetch origin changeset-release/main
git checkout changeset-release/main
```

If the branch has diverged from remote, reset to the remote version:

```bash
git reset --hard origin/changeset-release/main
```

## Step 3: Analyze the Changes

Read the current CHANGELOG.md to see what the automation generated:

```bash
head -50 CHANGELOG.md
```

Get the version from package.json:

```bash
cat package.json | grep '"version"'
```

**Present to the user:**
- The version number that will be released
- The raw changelog entries from the changeset PR
- Whether this is a patch, minor, or major release

## Step 4: Clean Up the Changelog

The changelog needs these fixes:

1. **Add brackets to version number**: Change `## 3.44.1` to `## [3.44.1]`

2. **No category headers**: Don't use `### Added`, `### Fixed`, etc. Just a flat list of bullet points.

3. **Order entries from most important to least important**:
   - Lead with major new features or significant fixes users care about
   - End with minor fixes or internal changes

4. **Write user-friendly descriptions**:
   - This is for end users, not developers—explain what changed in plain language
   - Remove commit hashes from the beginning of lines (the automation adds these)
   - Look at the actual commit diffs (`git show <hash>`) and PRs to understand what changed
   - Write colorful descriptions that explain the value and impact, not just technical details
   - Consolidate related changes into single entries when appropriate

**Ask the user** to review the proposed changelog changes before applying them. Show them:
- Current (raw) changelog section
- Proposed (cleaned) changelog section

Once approved, apply the changes to CHANGELOG.md.

## Step 5: Commit and Push Changes

After making changelog edits:

```bash
git add CHANGELOG.md
git commit -m "Clean up changelog formatting"
git push origin changeset-release/main
```

## Step 6: Merge the PR

**Ask the user to confirm** they're ready to merge.

Merge the PR with the proper commit message format:

```bash
VERSION=<version from package.json>
gh pr merge $PR_NUMBER --squash --subject "v${VERSION} Release Notes" --body ""
```

**If merge is blocked by branch protection:**
- Users with admin privileges can add the `--admin` flag to bypass
- Users without admin privileges need to get the PR approved through normal review first before merging

## Step 7: Tag the Release

After the merge completes, checkout main and pull:

```bash
git checkout main
git pull origin main
```

**IMPORTANT: Verify the latest commit is the release commit before tagging:**

```bash
git log -1 --oneline
```

Confirm the commit message matches `v{VERSION} Release Notes` (e.g., `v3.44.1 Release Notes`). Do NOT blindly tag HEAD without verification.

Once verified, tag and push:

```bash
VERSION=<version>
git tag v${VERSION}
git push origin v${VERSION}
```

## Step 8: Trigger Publish Workflow

**Copy the tag to clipboard** so the user can easily paste it into the GitHub Actions workflow:

```bash
echo -n "v{VERSION}" | pbcopy
```

**Tell the user to trigger the publish workflow:**
1. Go to: https://github.com/cline/cline/actions/workflows/publish.yml
2. Select **"release"** for release-type
3. Paste **`v{VERSION}`** as the tag (already in clipboard)

**Wait for the user** to confirm the publish workflow has completed before proceeding.

## Step 9: Update GitHub Release Notes

Once the user confirms the publish workflow is done, fetch the auto-generated release content:

```bash
VERSION=<version>
gh release view v${VERSION} --json body --jq '.body'
```

The auto-generated release has:
- `## What's Changed` - PR list (we'll replace this with our changelog)
- `## New Contributors` - First-time contributors (keep this if present)
- `**Full Changelog**` - Comparison link (keep this)

Build the new release body:
1. Start with `## What's Changed` header
2. Add our changelog content (from CHANGELOG.md for this version)
3. Keep the `## New Contributors` section if it exists
4. Keep the `**Full Changelog**` link

Update the release:

```bash
gh release edit v${VERSION} --notes "<new body content>"
```

Verify the release was updated:

```bash
gh release view v${VERSION}
```

## Step 10: Final Summary

**Copy a Slack announcement message to clipboard** (include the full changelog, not just highlights):

```bash
echo "VS Code v{VERSION} Released

- Changelog entry 1
- Changelog entry 2
- Changelog entry 3" | pbcopy
```

**Present a final summary:**
- Version released: v{VERSION}
- PR merged: #{PR_NUMBER}
- Tag pushed: v{VERSION}
- Release: https://github.com/cline/cline/releases/tag/v{VERSION}
- Slack message copied to clipboard

**Final reminder:**
Post the Slack message to announce the release

## Handling Edge Cases

### No changesets found
If the changeset PR body shows no changes, inform the user they need to merge PRs with changesets first.

### Merge conflicts
If there are conflicts on the changeset branch, help the user resolve them:
```bash
git fetch origin main
git rebase origin/main
# resolve conflicts
git push origin changeset-release/main --force-with-lease
```

### User wants to add more changes
If the user wants to include additional PRs before releasing:
1. Ask them to merge those PRs to main first
2. The changeset automation will update the PR automatically
3. Re-run this workflow after the PR is updated
