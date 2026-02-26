# Storage Architecture

Global settings, secrets and workspace state are stored in **file-backed JSON stores** under `~/.cline/data/`. This is the shared storage layer used by VSCode, CLI, and JetBrains.

## Key Abstractions

### `StorageContext` (src/shared/storage/storage-context.ts)
The entry point. Created via `createStorageContext()` and passed to `StateManager.initialize()`. Contains three `ClineFileStorage` instances:
- `globalState` → `~/.cline/data/globalState.json`
- `secrets` → `~/.cline/data/secrets.json` (mode 0o600)
- `workspaceState` → `~/.cline/data/workspaces/<hash>/workspaceState.json`

### `ClineFileStorage` (src/shared/storage/ClineFileStorage.ts)
Synchronous JSON key-value store backed by a single file. Supports `get()`, `set()`, `setBatch()`, `delete()`. Writes are atomic (write-then-rename).

### `StateManager` (src/core/storage/StateManager.ts)
In-memory cache on top of `StorageContext`. All runtime reads hit the cache; writes update cache immediately and debounce-flush to disk.

## ⚠️ Do NOT Use VSCode's ExtensionContext for Storage

**Do not** read from or write to `context.globalState`, `context.workspaceState`, or `context.secrets` for persistent data. These are VSCode-specific and not available on CLI or JetBrains.

Instead, use:
```typescript
// Reading state
StateManager.get().getGlobalStateKey("myKey")
StateManager.get().getSecretKey("mySecretKey")
StateManager.get().getWorkspaceStateKey("myWsKey")

// Writing state
StateManager.get().setGlobalState("myKey", value)
StateManager.get().setSecret("mySecretKey", value)
StateManager.get().setWorkspaceState("myWsKey", value)
```

Remember that your data may be read by a different client than the one that wrote it. For example, a value written by Cline in JetBrains may be read by Cline CLI.

## VSCode Migration (src/hosts/vscode/vscode-to-file-migration.ts)

On VSCode startup, a migration copies data from VSCode's `ExtensionContext` storage into the file-backed stores. This runs in `src/common.ts` before `StateManager.initialize()`.

- **Sentinel**: `__vscodeMigrationVersion` key in global state and workspace state — prevents re-migration.
- **Merge strategy**: File store wins. Existing values are never overwritten.
- **Safe downgrade**: VSCode storage is NOT cleared, so older extension versions still work.

## Adding New Storage Keys

1. Add to `src/shared/storage/state-keys.ts` (see existing patterns)
2. Read/write via `StateManager` (NOT via `context.globalState`)
3. If adding a secret, add to `SecretKeys` array in `state-keys.ts`

## File Layout

```
~/.cline/
  data/
    globalState.json          # Global settings & state
    secrets.json              # API keys (mode 0o600)
    tasks/
      taskHistory.json        # Task history (separate file)
    workspaces/
      <hash>/
        workspaceState.json   # Per-workspace toggles
```
