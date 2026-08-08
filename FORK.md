# Fork notes (cli-v3.0.49 + local patches)

This checkout is pinned at tag `cli-v3.0.49` on branch `fork-fixes`.
The global `cline` command is `bun link`'d from `apps/cli` so it runs
TypeScript source (via Bun), not the npm-published binary.

`~/bin/cline-qwen` prefers `~/.bun/bin/cline` so sessions always use this fork.

## Patches on this branch

1. **Background-command detach** — `sdk/packages/core/src/extensions/tools/executors/bash.ts`
   Resolve `run_commands` after the launched shell exits (with a short grace),
   instead of waiting for inherited stdio pipes that a `nohup … &` grandchild
   keeps open. Prevents the 30s timeout + process-group SIGKILL that used to
   kill intentionally-backgrounded jobs.

2. **Stringified `commands` unwrap** — `sdk/packages/core/src/extensions/tools/helpers.ts`
   Some models emit `commands` as a JSON-encoded string (or a 1-element array
   of that string). Unwrap before schema validation.

3. **Empty-response hardening** — `sdk/packages/llms/src/providers/middleware/retry-empty-response.ts`
   Treat whitespace-only deltas as empty; bump default max attempts 3 → 5.

## Config (not code)

- `~/.cline/data/settings/providers.json` → ollama `contextWindow: 65536`
  (drives both Ollama `num_ctx` and the compaction budget).
- `~/.cline/data/settings/global-settings.json` → `autoUpdateEnabled: false`
  (the npm binary must not overwrite our linked fork's PATH preference mid-session).

Compaction trigger / target ratios on this tag are already sensible
(`COMPACTION_TRIGGER_RATIO = 0.9`); no source change needed for that.

## Rebuild / re-link after edits

```bash
cd ~/src/cline
export PATH="$HOME/.bun/bin:$PATH"
bun run build:sdk          # required for bun-linked cline (no --conditions=development)
# or, for a one-off without rebuild:
bun run cli -- --version   # resolves packages from source
```

## Rebasing onto a newer CLI release

```bash
cd ~/src/cline
git fetch origin
git checkout fork-fixes
git rebase cli-vX.Y.Z      # or merge
# resolve any conflicts in the three files above
bun install && bun run build:sdk
cd apps/cli && bun link
```
