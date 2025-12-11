# Bcline Contributing Workflow

## ✅ Issues are Now Enabled!

Your Bcline fork now has issues enabled. Here's how to work on problems from the original cline repo.

---

## Workflow: Pick Issue → Fix → Submit PR

### Step 1: Browse Original Cline Issues

**View all open issues:**
```bash
gh issue list --repo cline/cline --limit 20
```

**Filter by label:**
```bash
# Just bugs
gh issue list --repo cline/cline --label bug --limit 20

# Good first issues (beginner-friendly)
gh issue list --repo cline/cline --label "good first issue" --limit 20

# VS Code specific
gh issue list --repo cline/cline --label "VS Code" --limit 20
```

**View on web:**
```bash
gh repo view cline/cline --web
# Click "Issues" tab
```

Or directly: https://github.com/cline/cline/issues

---

### Step 2: Pick an Issue to Work On

**Current Interesting Issues (as of Nov 15, 2025):**

1. **#7470 - Terminal commands with double quotes broken**
   - Type: Bug
   - Affects: Background Exec mode
   - Good for: Understanding command execution
   - URL: https://github.com/cline/cline/issues/7470

2. **#7468 - Ollama API requests not cancelled**
   - Type: Bug
   - Affects: API cleanup
   - Good for: Learning async/cancellation patterns
   - URL: https://github.com/cline/cline/issues/7468

3. **#7467 - Sonnet 4.5 missing path parameter**
   - Type: Bug
   - Affects: Claude Code provider
   - Good for: API integration
   - URL: https://github.com/cline/cline/issues/7467

4. **#7464 - LiteLLM proxy API key error**
   - Type: Bug
   - Affects: LiteLLM integration
   - Good for: Provider configuration
   - URL: https://github.com/cline/cline/issues/7464

5. **#7462 - Act mode not recognized**
   - Type: Bug
   - Affects: Mode detection
   - Good for: State management
   - URL: https://github.com/cline/cline/issues/7462

---

### Step 3: Create Tracking Issue in YOUR Fork (Optional)

Track your work locally:

```bash
# Create issue on YOUR Bcline fork
gh issue create --repo bob10042/Bcline \
  --title "Fix: Terminal double quotes (upstream #7470)" \
  --body "Working on fixing https://github.com/cline/cline/issues/7470

**Original Issue:**
Terminal commands with double quotes are broken when Terminal Execution Mode is set to Background Exec.

**Plan:**
1. Reproduce the bug
2. Locate the terminal execution code
3. Fix quote escaping
4. Test thoroughly
5. Submit PR to cline/cline

**Progress:**
- [ ] Issue reproduced
- [ ] Code located
- [ ] Fix implemented
- [ ] Tests added
- [ ] PR submitted
"
```

---

### Step 4: Create a Feature Branch

**IMPORTANT: Always work on a separate branch, NOT main!**

```bash
cd "c:\Users\bob43\Downloads\Bcline"

# Create and switch to new branch
git checkout -b fix-terminal-quotes

# Or for issue #7468
git checkout -b fix-ollama-cancel
```

**Branch Naming Convention:**
- `fix-<issue-name>` - For bug fixes
- `feature-<feature-name>` - For new features
- `issue-<number>` - Reference issue number

---

### Step 5: Work on the Fix

```bash
# Make sure you're on your branch
git branch
# Should show: * fix-terminal-quotes

# Open in VS Code
code .

# Make your changes...
# Edit files, test, debug, etc.

# Commit frequently
git add <changed-files>
git commit -m "Fix terminal quote escaping

- Added proper quote handling in background exec mode
- Fixes issue cline/cline#7470"

# Push to YOUR fork
git push origin fix-terminal-quotes
```

---

### Step 6: Test Your Fix

**Run the extension:**
```bash
# Open Bcline in VS Code
cd "c:\Users\bob43\Downloads\Bcline"
code .

# Press F5 to launch Extension Development Host
# Test your fix in the new window
```

**Run tests (if available):**
```bash
npm test
```

**Manual testing checklist:**
- [ ] Bug is fixed
- [ ] No new bugs introduced
- [ ] Existing features still work
- [ ] Code follows project style

---

### Step 7: Submit Pull Request to Original Cline

**When your fix is ready:**

```bash
# Make sure all changes are committed
git status

# Push to YOUR fork (if not already)
git push origin fix-terminal-quotes

# Create PR to ORIGINAL cline repo
gh pr create \
  --repo cline/cline \
  --head bob10042:fix-terminal-quotes \
  --title "Fix: Terminal commands with double quotes in Background Exec mode" \
  --body "## Description
Fixes #7470

Terminal commands containing double quotes were not being properly escaped when using Background Exec mode.

## Changes
- Added quote escaping in \`executeCommand()\` function
- Updated terminal command builder to handle special characters
- Added test cases for quote handling

## Testing
- [x] Tested with various quoted commands
- [x] Verified Background Exec mode works correctly
- [x] Existing tests pass
- [x] No regressions in normal mode

## Screenshots
(Add if relevant)

## Checklist
- [x] Code follows project style guidelines
- [x] Tests added/updated
- [x] Documentation updated (if needed)
- [x] Tested locally"
```

**The PR goes to `cline/cline`, NOT your fork!**

---

### Step 8: Respond to PR Feedback

**Maintainers might request changes:**

```bash
# Make requested changes
# Edit files...

# Commit
git add .
git commit -m "Address PR feedback: Add edge case handling"

# Push (automatically updates the PR)
git push origin fix-terminal-quotes
```

The PR automatically updates when you push to the same branch!

---

### Step 9: After PR is Merged

**If your PR gets merged into cline/cline:**

```bash
# Sync your fork with the now-updated original
gh repo sync bob10042/Bcline --source cline/cline

# Switch back to main
cd "c:\Users\bob43\Downloads\Bcline"
git checkout main

# Pull the updates (which include YOUR merged fix!)
git pull origin main

# Delete your feature branch (no longer needed)
git branch -d fix-terminal-quotes
git push origin --delete fix-terminal-quotes

# Close your tracking issue (if you created one)
gh issue close <issue-number> --repo bob10042/Bcline
```

**Celebrate! You contributed to open source! 🎉**

---

## Quick Reference Commands

### Issue Management

```bash
# View original cline issues
gh issue list --repo cline/cline --limit 20

# Create tracking issue on YOUR fork
gh issue create --repo bob10042/Bcline --title "..." --body "..."

# View YOUR issues
gh issue list --repo bob10042/Bcline

# Close YOUR issue
gh issue close <number> --repo bob10042/Bcline
```

### Branch Workflow

```bash
# Create branch
git checkout -b fix-something

# Check current branch
git branch

# Switch branches
git checkout main
git checkout fix-something

# Push branch to YOUR fork
git push origin fix-something

# Delete branch (after PR merged)
git branch -d fix-something
git push origin --delete fix-something
```

### Pull Request Workflow

```bash
# Create PR to original cline
gh pr create --repo cline/cline --head bob10042:branch-name --title "..." --body "..."

# View your PRs
gh pr list --repo cline/cline --author bob10042

# View PR status
gh pr view <number> --repo cline/cline

# Update PR (just push to same branch)
git push origin branch-name
```

### Syncing

```bash
# Sync your fork with original
gh repo sync bob10042/Bcline --source cline/cline

# Or manually
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

---

## Best Practices

### 1. **One Issue Per Branch**
Don't mix multiple fixes in one branch/PR.

### 2. **Keep Branches Updated**
```bash
# While working on a fix, keep it updated with main
git checkout fix-something
git merge main
```

### 3. **Write Clear Commit Messages**
```bash
# Good
git commit -m "Fix quote escaping in terminal commands

- Handle double quotes properly
- Add test cases
- Fixes #7470"

# Bad
git commit -m "fix bug"
```

### 4. **Test Before Submitting PR**
- Run existing tests
- Test manually
- Check for regressions

### 5. **Reference Issues in PR**
Use "Fixes #7470" in PR description to auto-link and auto-close the issue when merged.

### 6. **Be Responsive**
- Check PR for maintainer comments
- Respond to feedback quickly
- Make requested changes

### 7. **Don't Work on Main**
Always use feature branches. Keep `main` clean for syncing.

---

## Example Full Workflow

```bash
# 1. Find issue on original repo
gh issue view 7470 --repo cline/cline

# 2. Create tracking issue on YOUR fork (optional)
gh issue create --repo bob10042/Bcline --title "Fix terminal quotes"

# 3. Create feature branch
cd "c:\Users\bob43\Downloads\Bcline"
git checkout -b fix-terminal-quotes

# 4. Make changes
code .
# Edit files...

# 5. Commit
git add .
git commit -m "Fix terminal quote escaping"

# 6. Push to YOUR fork
git push origin fix-terminal-quotes

# 7. Create PR to ORIGINAL
gh pr create --repo cline/cline \
  --head bob10042:fix-terminal-quotes \
  --title "Fix: Terminal quotes in Background Exec" \
  --body "Fixes #7470..."

# 8. Wait for review, make changes if needed
# Edit files based on feedback...
git add .
git commit -m "Address review feedback"
git push origin fix-terminal-quotes

# 9. After merge
gh repo sync bob10042/Bcline --source cline/cline
git checkout main
git pull origin main
git branch -d fix-terminal-quotes
```

---

## Current Status

✅ **Issues enabled on bob10042/Bcline**
✅ **Fork synced with cline/cline**
✅ **Ready to start contributing**

**Next Steps:**
1. Browse issues: https://github.com/cline/cline/issues
2. Pick one that interests you
3. Create a branch and start coding!

**Good Luck! 🚀**
