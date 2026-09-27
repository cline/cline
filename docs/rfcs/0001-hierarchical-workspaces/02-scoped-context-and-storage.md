# RFC 0001: Scoped Context & Storage Specification

- **Module:** Scoped Context & Persistence
- **Target Package:** `@cline/shared`, `@cline/core`

---

## 1. Context & Rule Layering Rules

When building system prompts and assembling agent context, the configuration loader merges instructions across layers using strict precedence:

```text
Priority Hierarchy:
[High]   1. Primary Workspace Root (apps/cli/.cline)
         2. Intermediate Ancestors (if any)
         3. Repository Root Ancestor (repo/.cline)
[Low]    4. User Global Configuration (~/.cline)
```

### 1.1. Rules (`.cline/rules/`, `.clinerules`, `AGENTS.md`)
- **Additive by default**: General rules from ancestor layers (e.g. `repo/.cline/rules/security.md`) apply automatically to sub-projects.
- **Filename Override**: If a primary workspace defines a rule file with the identical base name as an ancestor rule (e.g. `repo/.cline/rules/formatting.md` vs `apps/cli/.cline/rules/formatting.md`), the primary workspace version completely replaces the ancestor version.
- **`AGENTS.md` Merging**: Primary `AGENTS.md` takes precedence; ancestor `AGENTS.md` instructions are appended as base organizational context.

### 1.2. Skills (`.cline/skills/`, `.agents/skills/`)
- **Deduplication by Name**: Skills are identified by their declared skill name in frontmatter or directory name.
- **Leaf Precedence**: If both `/repo/.cline/skills/build` and `apps/cli/.cline/skills/build` exist, the `apps/cli` implementation is registered.

### 1.3. Workflows & Agent Definitions
- Workflows defined in child workspaces augment ancestor workflows.
- Conflicting workflow triggers or slash commands resolve in favor of the leaf layer.

---

## 2. Session Persistence & History Partitioning

Currently, `SqliteSessionStore` stores session records in `~/.cline/data/db/sessions.db`:
```sql
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    ...
);
```

Because `workspace_root` historically stored whichever arbitrary path was opened in VS Code or CLI, querying sessions across monorepo subprojects has been inconsistent.

### 2.1. Database Schema Migration

```sql
-- Migration: Add canonical anchor_workspace_path to sessions table
ALTER TABLE sessions ADD COLUMN anchor_workspace_path TEXT;

-- Create index for fast scoped history lookup
CREATE INDEX IF NOT EXISTS idx_sessions_anchor ON sessions(anchor_workspace_path, started_at DESC);
```

### 2.2. Session Record Stamping
When a session is created:
- `cwd`: The exact execution path where the agent operates (e.g. `/repo/apps/cli/src`).
- `workspace_root`: Retained for backward compatibility.
- `anchor_workspace_path`: The canonical, resolved **Primary Workspace Anchor** (e.g. `/repo/apps/cli` or `/repo`).

### 2.3. Scoped History Query API

The `listHistory` interface on `SessionStore` and `RuntimeHost` is extended with scope options:

```typescript
export interface SessionHistoryFilterOptions {
  /** The anchor path of the active workspace */
  anchorPath?: string;
  /**
   * - "current": Only sessions directly anchored to this workspace
   * - "hierarchical": Sessions anchored to this workspace OR any of its known sub-clines
   * - "all": Unfiltered global session history
   */
  scope?: "current" | "hierarchical" | "all";
  limit?: number;
  offset?: number;
}
```

#### SQL Implementation:
- **`current` Scope**:
  ```sql
  SELECT * FROM sessions 
  WHERE anchor_workspace_path = :anchorPath 
  ORDER BY started_at DESC LIMIT :limit;
  ```
- **`hierarchical` Scope**:
  ```sql
  SELECT * FROM sessions 
  WHERE anchor_workspace_path = :anchorPath 
     OR anchor_workspace_path LIKE :anchorPathPrefix 
  ORDER BY started_at DESC LIMIT :limit;
  ```
- **`all` Scope**:
  Unfiltered query preserving current behavior.

---

## 3. Backward Compatibility for Historical Sessions

For existing records in `sessions.db` where `anchor_workspace_path` is `NULL`:
1. **Lazy Backfill**: On startup or during migration, an asynchronous migration parses historical `cwd` values using `resolveHierarchicalWorkspace(cwd)` and populates `anchor_workspace_path`.
2. **Fallback Querying**: If `anchor_workspace_path` is null, queries fall back to matching against `workspace_root = :anchorPath` or `cwd LIKE :anchorPath%`.
