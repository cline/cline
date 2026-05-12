# Commit and Merge to Dev

Submit changes on the current feature branch, merge `upstream/main` into `dev`, and merge the feature branch into `dev`.

## Overview

This workflow helps you:
1. Stage, commit, and push your changes to the remote feature branch
2. Switch to `dev`, merge `upstream/main` (sync with upstream)
3. Merge the feature branch into `dev`
4. Push `dev` to `origin`

## Process

### 1) Check current branch and status

```bash
git status --short
git branch --show-current
```

Confirm with the user which branch and what changes will be committed.

### 2) Stage and commit changes

```bash
git add <files>
git commit -m "<type>: <description>"
```

Commit message format follows conventional commits:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring
- `chore:` — maintenance, tooling
- `docs:` — documentation only

Include a detailed body in the commit message if the change is complex.

### 3) Push to remote feature branch

```bash
git push origin <branch-name>
```

### 4) Switch to dev and sync with upstream

```bash
git checkout dev
git pull origin dev
git pull upstream main --no-edit
```

If conflicts occur, resolve them.

### 5) Merge feature branch into dev

```bash
git merge <branch-name> --no-edit
```

### 6) Push dev to origin

```bash
git push origin dev