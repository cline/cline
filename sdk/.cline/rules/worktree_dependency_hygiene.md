### Worktree Dependency Hygiene
 
When working in a git worktree, verify dependency links before running CLI repros,
tests, hooks, or commits. `node_modules` symlinks can accidentally point at
another checkout, causing mixed-source type errors or runtime behavior.
 
Quick check:
 
```sh
realpath node_modules packages/core/node_modules packages/core/node_modules/@cline/llms
```
 
All paths should stay under the current worktree. If any path points to another
checkout, remove the bad `node_modules` symlinks and run `bun install` from the
worktree root before trusting test or hook results.
