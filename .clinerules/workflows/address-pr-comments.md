# Address PR Comments

Review and address all comments on the current branch's PR.

## Steps

1. Get the current branch name and find the associated PR:
   ```bash
   gh pr view --json number,title,body
   ```

2. Understand the PR context:
   - Get the full diff: `git diff origin/main...HEAD`
   - Read the changed files to understand what the PR is doing
   - Read related files if needed to understand the broader context
   - Understand the intent and spirit of the changes, not just the code

3. Fetch all PR comments:
   - Inline comments: `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments`
   - General comments: `gh pr view {pr_number} --json comments,reviews`

4. Present a summary of all comments with your recommendation for each (apply, skip, or respond). Ignore bot noise (changeset-bot, CI status, etc.).

5. **Wait for my approval** before proceeding.

6. After approval:
   - Apply code changes and commit
   - Reply to comments that were addressed or intentionally skipped
   - Push commits
