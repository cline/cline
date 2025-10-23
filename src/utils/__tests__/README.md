# Git Utils Tests

This directory contains unit tests for git utility functions, with comprehensive coverage of git worktree scenarios.

## Running the Tests

To run the git worktree tests specifically:

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha "src/utils/__tests__/git.test.ts" --require ts-node/register --require tsconfig-paths/register --timeout 10000
```

Or to run all unit tests in this directory:

```bash
npm run test:unit -- "src/utils/__tests__/**/*.test.ts"
```

## Test Coverage

The `git.test.ts` file includes 26 tests covering:

- **checkGitRepo**: Detecting git repositories in worktrees, bare repos, and non-git directories
- **isGitRepository**: Repository detection across different git structures
- **getGitDiff**: Getting diffs from worktrees with staged and unstaged changes
- **getWorkingState**: Detecting changes in worktrees and handling new repositories
- **getLatestGitCommitHash**: Retrieving commit hashes from different worktrees

### Worktree-Specific Scenarios

The tests create real git structures including:
- Bare repositories
- Multiple worktrees from the same bare repo
- Nested worktree paths
- Subdirectories within worktrees
- Independent commits in different worktrees

## Test Structure

Each test creates a temporary directory structure like:

```
/tmp/cline-git-test-XXXXX/
├── repo.git/          # Bare repository
├── main/              # Main worktree
└── feature/           # Feature worktree
```

All temporary structures are cleaned up after each test.
