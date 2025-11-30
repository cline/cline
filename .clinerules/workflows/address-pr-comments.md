# Address PR Comments

Review and address all comments on the current branch's PR.

## Steps

1. Get the current branch name and find the associated PR:
   ```bash
   gh pr view --json number,title,body -q '.number, .title, .body'
   ```

2. Understand the PR context:
   - Get the full diff: `git diff origin/main...HEAD`
   - Read the changed files to understand what the PR is doing
   - Read related files if needed to understand the broader context
   - Understand the intent and spirit of the changes, not just the code

3. Fetch all PR comments:
   - Inline code comments (including Copilot suggestions):
     ```bash
     gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
     ```
   - General PR comments:
     ```bash
     gh pr view {pr_number} --json comments,reviews
     ```

4. Present a summary table of all comments for my review:

   | # | Author | Type | File/Line | Summary | Recommendation |
   |---|--------|------|-----------|---------|----------------|
   | 1 | Copilot | suggestion | foo.ts:42 | Fix syntax in X | ✅ Apply |
   | 2 | Copilot | suggestion | bar.ts:10 | Add strict types | ❌ Skip - overkill for this use case |
   | 3 | @reviewer | question | general | Why did you choose X? | 💬 Respond |

   For each recommendation, briefly explain your reasoning.

5. **Wait for my approval** before proceeding.

6. After approval, for comments we're applying:
   - Make the code changes
   - Stage and commit with message: "Address PR feedback: <brief summary>"

7. For comments we're responding to:
   - Draft the response and show it to me
   - Post using: `gh pr comment {pr_number} --body "<response>"`

8. Push any commits made

## Comment Types

- **suggestion**: Code change proposed (often from Copilot with ```suggestion blocks)
- **nitpick**: Minor improvement, usually worth applying
- **question**: Needs a response, not a code change
- **discussion**: Back-and-forth that may or may not need action
- **bot noise**: Automated comments (changeset-bot, CI status) → ignore

## Output

After processing, summarize:
- ✅ Applied: changes made
- 💬 Responded: comments addressed with replies
- ⏭️ Skipped: bot/noise comments ignored
