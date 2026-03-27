# Worktree Lifecycle Reference

## Git Worktree Commands

### Create

```bash
# Create worktree with new branch
git worktree add <path> -b wf/<workflow-slug>

# Example
git worktree add ../wt-content-pipeline -b wf/content-pipeline
```

### List

```bash
git worktree list
```

### Remove (Prune)

```bash
# Remove worktree (keeps branch)
git worktree remove <path>

# Remove worktree and delete branch
git worktree remove <path>
git branch -D wf/<workflow-slug>
```

## Pre-flight Checks

Before creating a worktree, verify:

1. **Branch does not exist**: `git branch --list wf/<slug>` should return empty
2. **Path does not exist**: the target directory should not exist
3. **Working tree is clean**: `git status --porcelain` should be empty (or warn user)

If any check fails:
- **Branch exists**: Ask user — resume existing worktree or choose a different name?
- **Path exists**: Ask user — remove and recreate, or choose a different path?
- **Dirty working tree**: Warn user but allow proceeding (worktree add works on dirty trees)

## .worktreeinclude Processing

The `.worktreeinclude` file in the base repo defines local (gitignored) files that should be copied to new worktrees.

### Default Copy Rules

```
.env
.env.local
.env.*
**/.claude/settings.local.json
```

### Copy Logic

1. Check if `.worktreeinclude` exists in base repo root — if not, skip copying
2. For each line in `.worktreeinclude`:
   - Skip empty lines and lines starting with `#`
   - Use the line as a glob pattern
   - Find matching files in the base repo
   - Copy each match to the equivalent relative path in the new worktree
   - Create parent directories as needed
   - Log each copied file

### Implementation (Claude should execute these commands)

For simple patterns (no `**`):

```bash
# Check if file exists and copy
if [ -f ".env" ]; then
  cp .env <WORKTREE_PATH>/.env
fi

if [ -f ".env.local" ]; then
  cp .env.local <WORKTREE_PATH>/.env.local
fi
```

For recursive glob patterns (`**/.claude/settings.local.json`):

```bash
# Use find for recursive patterns
find . -path '*/.claude/settings.local.json' -not -path './.git/*' 2>/dev/null | while read -r file; do
  target_dir="$(dirname "<WORKTREE_PATH>/$file")"
  mkdir -p "$target_dir"
  cp "$file" "<WORKTREE_PATH>/$file"
done
```

### Important Notes

- `.worktreeinclude` patterns match gitignored files — these are intentionally NOT in git
- If no files match a pattern, silently skip (do not error)
- Never copy `.git/` directory contents
- The new worktree already has its own `.git` file pointing to the base repo's `.git/worktrees/`

## Path Convention

| Component | Pattern | Example |
|-----------|---------|---------|
| Base repo | `<workspace>/<project>` | `~/Desktop/workspace/a2c_life` |
| Worktree | `<workspace>/wt-<slug>` | `~/Desktop/workspace/wt-content-pipeline` |
| Branch | `wf/<slug>` | `wf/content-pipeline` |

Worktrees are created as siblings of the base repo, not inside it.

## Complete Provisioning Sequence

Execute these steps in order:

```
1. Pre-flight checks (branch, path, clean tree)
2. git worktree add <path> -b wf/<slug>
3. Process .worktreeinclude (copy local files)
4. Create scaffold files (CLAUDE.md, workflow.md, etc.)
5. Create directories (questions/, artifacts/)
6. Verify (git worktree list, file existence check)
7. Display summary
```
