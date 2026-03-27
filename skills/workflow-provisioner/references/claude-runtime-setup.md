# Claude Runtime Setup Reference

## Runtime Isolation Model

Each workflow runs in its own worktree with its own Claude session:

```
one workflow = one worktree + one Claude session
```

This ensures:
- No context leakage between workflows
- Independent file state per workflow
- Project-scoped CLAUDE.md per workflow
- Independent progress tracking

## Project-Owned Workflow Assets

The active workflow contract lives inside the project, not in machine-global skill or rule directories:

- `.agent/.aidlc-rule-details/` — project-owned foundation rules
- `.agent/skills/` — only editable skill source
- `.agent/workflow-bundle/` — workflow metadata and bootstrap assets

`.claude/skills` is only a runtime adapter to `.agent/skills`, not an independent source of truth. The same rule applies to `.codex/skills`.

## How Claude Discovers the Workflow

When Claude starts in a worktree directory, it reads:

1. **CLAUDE.md** — Primary runtime instructions
2. **.claude/settings.local.json** — Local project settings (if exists)
3. **workflow.md** — Stage definitions (referenced from CLAUDE.md)
4. **workflow-state.md** — Current progress (referenced from CLAUDE.md)
5. **.claude/skills -> ../.agent/skills** — Runtime exposure of the project-local skill bundle

Claude reads the skill bundle through `.claude/skills`, but the editable source remains `.agent/skills`.

This is the same precedence that Claude Code uses for any project:

```
Enterprise policies > CLI arguments > Local project settings
> Shared project settings > User settings
```

## Starting a Workflow Session

### Option A: VS Code / Cursor

1. Add the worktree folder to workspace: `File > Add Folder to Workspace...`
2. Open a terminal in the worktree folder
3. Run `claude` — Claude reads CLAUDE.md from the worktree

### Option B: Terminal

```bash
cd <worktree-path>
claude
```

### Option C: Claude Code CLI

```bash
claude --directory <worktree-path>
```

## Session Continuity

When resuming a workflow:

1. Claude reads CLAUDE.md (always)
2. CLAUDE.md instructs Claude to read workflow-state.md
3. workflow-state.md shows which stage was last completed
4. Claude resumes from the next pending stage
5. audit.md provides history context

## Multi-Workflow Parallel Execution

Multiple workflows can run simultaneously in separate terminals:

```
Terminal 1: cd ~/workspace/wt-workflow-a && claude
Terminal 2: cd ~/workspace/wt-workflow-b && claude
```

Each session is fully independent — different CLAUDE.md, different files, different progress.

The runtime adapter model also means different tools can stay consistent:

- Claude Code reads `.claude/skills -> ../.agent/skills`
- Codex reads `.codex/skills -> ../.agent/skills`

Neither tool-specific directory should accumulate copied project skill sources.

## Cleanup

When a workflow is complete:

```bash
# Archive: keep the worktree but mark as done
# (update workflow-state.md status to "Archived")

# Prune: remove the worktree entirely
cd <base-repo>
git worktree remove <worktree-path>
git branch -D wf/<workflow-slug>  # optional: delete branch too
```
