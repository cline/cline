# RFC 0001: Phased Implementation Roadmap & Verification

- **Module:** Implementation Roadmap & Verification
- **Target Surfaces:** Entire Monorepo
- **Status:** As-built reconciliation — Phases 1–5 and all follow-ups shipped
- **Reconciled:** 2026-09-27 against branch `rfc/hierarchical-workspaces`

> **Package naming (important).** The VS Code extension is `apps/vscode` and its package
> name is **`claude-dev`** (publisher `saoudrizwan`). The workspace package
> **`@cline/vscode` is `apps/examples/vscode`** — an unrelated example app which has no
> `test:unit` script. Earlier drafts of this document addressed `-F @cline/vscode`, i.e.
> the wrong package. (The desktop app reference in `03-onboarding-and-ux.md` is correct:
> `@cline/code` really is `apps/examples/desktop-app`.)

---

## 1. Phased Execution Roadmap

The implementation is broken down into 5 decoupled phases following our architectural rules: minimizing change amplification, reader-centric design, and deep interfaces.

| Phase | Scope | Status | Commit |
|---|---|---|---|
| 1 | Core hierarchy resolution (`@cline/shared`) | ✅ Shipped | `dfd31c2cf` |
| 2 | Layered storage paths & config watching (`@cline/shared`, `@cline/core`) | ✅ Shipped | `b75af8192` |
| 3 | SQLite session history partitioning (`@cline/shared`, `@cline/core`) | ✅ Shipped | `29f8fbfd1` |
| 4 | CLI surface integration (`@cline/cli`) | ✅ Shipped | `5c6abc955` |
| 5 | VS Code extension integration (`apps/vscode`, package `claude-dev`) | ✅ Shipped | `807035239` |

Phases 1–5 each landed as one self-contained commit whose tests pass independently of the later phases.

```mermaid
flowchart LR
    P1["Phase 1 ✅<br/>shared: resolver + schema"] --> P2["Phase 2 ✅<br/>shared+core: layered paths"]
    P2 --> P3["Phase 3 ✅<br/>shared+core: anchor column"]
    P3 --> P4["Phase 4 ✅<br/>cli: onboarding + history scope"]
    P4 --> P5["Phase 5 ✅<br/>apps/vscode: status bar + card + history scope"]
```

### Phase 1: Core Hierarchy Resolution (`@cline/shared`) — ✅ Shipped (`dfd31c2cf`)

- **Deliverables (as built)**:
  - `WorkspaceConfigSchema` lives in `sdk/packages/shared/src/storage/workspace-schema.ts` (a separate module, not inline in `workspace.ts`):
    `name?`, `includes` (default `[]`), `ignores` (default `[]`), `isolated` (default `false`), `inheritMcpServers` (default `true`), `metadata?` typed `z.record(z.string(), z.unknown())`.
  - Resolver in `sdk/packages/shared/src/storage/workspace.ts`:
    - `findWorkspaceHierarchySync(startPath, options?)` — the real implementation (upward traversal plus layer assembly).
    - `resolveHierarchicalWorkspaceSync(startPath, options?)` — returns `ResolvedHierarchicalWorkspace`.
    - `findWorkspaceHierarchy` / `resolveHierarchicalWorkspace` — thin `async` wrappers delegating to the `*Sync` versions. Earlier drafts named only the async spellings; both forms exist and are exported.
  - Public surface re-exported from `@cline/shared/storage`: `WorkspaceConfigSchema`, `loadWorkspaceConfigSync`, `WORKSPACE_CONFIG_FILE_NAME`, `CLINE_BOUNDARY_FILE_NAME`, `CLINE_IGNORE_FILE_NAME`, `loadClineIgnorePatternsSync`, `globToRegExp`, `matchesGlob`, `matchesAnyGlob`, plus the `WorkspaceLayer`, `ResolvedHierarchicalWorkspace`, and `ResolveWorkspaceOptions` types.
  - Boundary stops, evaluated per directory as traversal ascends: isolation (`"isolated": true`, or a `.cline-boundary` marker at the workspace root **or** inside `.cline/`), Git root (`.git` present; `stopAtGitRoot` defaults to `true`), user home (`options.userHomeDir`, defaults to `os.homedir()`), filesystem root (`dirname(dir) === dir`). A normalized-path `visited` set breaks cycles.
  - A directory counts as a layer when it holds `.cline/` or the legacy `.clinerules` marker; `loadWorkspaceConfigSync` substitutes schema defaults when `.cline/workspace.json` is missing or fails validation.
  - Glob matching via `globToRegExp` / `matchesGlob`: `*`, `**`, `?`, `dir/**` (which also matches the directory itself), and basename patterns without `/` matching at any depth.
  - `discoveredSubClines` via `discoverSubClinesSync`: BFS from each `includes` glob's literal prefix, depth-capped at 4, skipping `node_modules` / `.git` / `.cline`, honoring `ignores` plus `.clineignore`, and admitting only directories that themselves contain `.cline/` or `.clinerules`.
- **Testing (as built)** — `sdk/packages/shared/src/storage/workspace.test.ts`, 22 tests:
  - `WorkspaceConfigSchema`: defaults, custom configuration, invalid types.
  - `Glob matching`: exact paths, `*`, `**`, `dir/**`, basename-at-any-depth, `matchesAnyGlob`.
  - `Hierarchical Workspace Resolution`: nearest-root-first ordering, parent inheritance for a subfolder without `.cline`, uninitialized detection, isolation via `isolated: true` and via `.cline-boundary`, Git-root stop, sub-cline discovery through `includes`, file-path `startPath`, and sync/async equivalence.
- **Known gaps**: the originally planned edge-case tests for symlinks, directory loops, unreadable parent directories, and Windows drive roots were **not written**. Cycle protection exists in code (the `visited` set) but carries no assertion; unreadable-parent and Windows drive-root behavior is unverified.

### Phase 2: Layered Storage Paths & Dynamic Watching (`@cline/shared` & `@cline/core`) — ✅ Shipped (`b75af8192`)

- **Deliverables (as built)**:
  - `sdk/packages/shared/src/storage/paths.ts` gained the `WorkspacePathOrLayers` type (`string | ReadonlyArray<string | WorkspaceLayer> | ResolvedHierarchicalWorkspace`) and `extractWorkspaceLayerPaths()`, which resolves a bare path through `findWorkspaceHierarchySync()` when it exists on disk. Every layer-aware resolver takes `workspacePath?: WorkspacePathOrLayers`, so existing `string` call sites keep working unchanged.
  - More resolvers were adapted than the plan listed: `resolveRulesConfigSearchPaths`, `resolveSkillsConfigSearchPaths`, `resolveAgentConfigSearchPaths`, `resolveWorkflowsConfigSearchPaths`, **plus** `resolveHooksConfigSearchPaths` and `resolvePluginConfigSearchPaths`.
  - Override and dedup semantics are encoded in path order, with `dedupePaths()` preserving first-seen order:
    - rules: global `~/.agents/AGENTS.md` and global rules directories first, then each layer ancestor→leaf contributing `AGENTS.md`, `.clinerules`, `.cline/rules`.
    - skills: global `~/.cline/skills`, legacy `~/.agents/skills`, then each layer's `.clinerules/skills`, `.cline/skills`, `.agents/skills`.
    - agents: layers **reversed (leaf first)** so first match wins.
    - workflows: each layer's `.clinerules/workflows`, then global, then each layer's `.cline/workflows` last so the leaf `.cline` directory wins.
  - Layer-aware loading in `sdk/packages/core/src/extensions/config/user-instruction-config-loader.ts`: `createRulesConfigDefinition` / `createSkillsConfigDefinition` / `createWorkflowsConfigDefinition` add each layer's `.cline` to `directories` (the `managedRoots` list), and rule entries are deduplicated/overridden **by file basename**, so a child `foo.md` replaces an ancestor `foo.md`. `createUserInstructionConfigWatcher()` then constructs the generic watcher over all layer directories, which is what makes parent edits hot-reload into an active child session.
  - **Correction:** `UnifiedConfigFileWatcher` (`sdk/packages/core/src/extensions/config/unified-config-file-watcher.ts`) was **not modified** by this phase — its most recent change is `700095d17`. It is reused as-is and merely configured with the multi-layer directory list, so listing it as a deliverable was inaccurate. The type alias `UserInstructionConfigWatcher` is a `UnifiedConfigFileWatcher<...>` specialization.
- **Testing (as built)**:
  - `sdk/packages/shared/src/storage/paths.test.ts` → `describe("hierarchical workspace paths")`: layer extraction from every input shape; ancestor-before-leaf ordering for rules and skills; leaf-first for agents; leaf `.cline` workflows last.
  - `sdk/packages/core/src/extensions/config/user-instruction-config-loader.test.ts`: "inherits ancestor rules and overrides matching filename in child workspace", "lets child skills and workflows override parent while inheriting non-conflicting ones", "preserves both primary and ancestor AGENTS.md rules without collision", "lets workspace .cline workflows override legacy .clinerules workflows with the same name", and "hot-reloads when adding or editing a rule in parent workspace during active child session".
  - Both planned verification bullets (hot-reload in an active child session; same-name child override) are covered.

### Phase 3: SQLite Session History Partitioning (`@cline/shared` & `@cline/core`) — ✅ Shipped (`29f8fbfd1`)

- **Deliverables (as built)**:
  - **Schema, migration, and index live in `@cline/shared`, not `@cline/core`** — `sdk/packages/shared/src/db/sqlite-db.ts`:
    - the `sessions` CREATE TABLE now includes `anchor_workspace_path TEXT`;
    - migration entry `{ table: "sessions", column: "anchor_workspace_path", sql: "ALTER TABLE sessions ADD COLUMN anchor_workspace_path TEXT;" }`;
    - backfill `UPDATE sessions SET anchor_workspace_path = COALESCE(NULLIF(workspace_root, ''), cwd) WHERE anchor_workspace_path IS NULL OR anchor_workspace_path = ''`;
    - index `CREATE INDEX IF NOT EXISTS idx_sessions_anchor ON sessions(anchor_workspace_path, started_at DESC)`.
  - Store API in `sdk/packages/core/src/services/storage/sqlite-session-store.ts`:
    - `create(record)` stamps the anchor: explicit `record.anchorWorkspacePath` → else a hierarchy resolution from the recorded cwd/workspace root → else `workspaceRoot || cwd`.
    - `update(record)` accepts `anchorWorkspacePath`.
    - `listHistory({ anchorPath, scope, limit, offset, ... })` with `scope: "current" | "hierarchical" | "all"`. `current` matches `anchor_workspace_path = ?` **or** the legacy fallback `(anchor_workspace_path IS NULL AND (workspace_root = ? OR cwd = ?))`; `hierarchical` adds the subtree clause `anchor_workspace_path LIKE '<anchorPath>/%'`; `all` (or an omitted scope) is unfiltered.
  - Filter options plumbed through `sdk/packages/core/src/types/storage.ts` (`SessionHistoryFilterOptions`), `types/session.ts`, `runtime/host/history.ts`, `runtime/host/runtime-host.ts`, `runtime/host/local-runtime-host.ts`, `runtime/host/local/session-record.ts`, `session/models/session-row.ts`, `session/models/session-manifest.ts`, `session/services/session-service.ts`, `session/services/persistence-service.ts`, `session/services/file-session-service.ts`, `services/session-data.ts`, `services/storage/session-store.ts`, and `sdk/packages/shared/src/session/records.ts`.
  - **Backfill is two-layered**, which is more than the plan's single migration: the SQL `UPDATE` above runs once at migration time, and `SqliteSessionStore` additionally lazily backfills rows still holding a `NULL`/empty anchor, re-resolving the hierarchy and writing the resolved `primaryRoot`. Hosts read the value back through `manifest.anchor_workspace_path` (`runtime/host/history.ts`).
- **Testing (as built)**:
  - `sdk/packages/shared/src/db/sqlite-db.test.ts` → "adds anchor_workspace_path and creates idx_sessions_anchor on legacy schema": asserts the column exists on a legacy schema, the backfilled value, index creation, and that pre-existing rows survive.
  - `sdk/packages/core/src/services/storage/sqlite-session-store.test.ts` → `describe("scoped history querying (list and listHistory)")`, including distinct `current` vs `hierarchical` result sets and pagination.
  - `sdk/packages/core/src/session/services/persistence-service.test.ts` (current / hierarchical / all) and `sdk/packages/core/src/runtime/host/history.test.ts`.

### Phase 4: CLI Surface Integration (`@cline/cli`) — ✅ Shipped (`5c6abc955`)

- **Deliverables (as built)**:
  - Boot hook: a single helper `resolveWorkspaceRoot(cwd)` in `apps/cli/src/utils/helpers.ts` — returns the hierarchical `primaryRoot` when `findWorkspaceHierarchySync(cwd).isInitialized`, else `git rev-parse --show-toplevel`, else `cwd`. The plan described hooking `runInteractive` / `runAgent`; as built, one helper is consumed by `apps/cli/src/main.ts` (interactive and headless paths), `session/session.ts`, `acp/acpAgent.ts`, `connectors/session-runtime.ts`, `utils/chat-commands.ts`, and `runtime/run-interactive.ts`.
  - Onboarding: `apps/cli/src/tui/components/dialogs/workspace-onboarding.tsx` plus `workspace-onboarding-helpers.ts` (`ONBOARDING_OPTIONS`, `resolveOnboardingKeyAction`, `resolveInheritanceKeyAction`, `formatDisplayPath`), mounted from `apps/cli/src/tui/root.tsx` through its `readWorkspaceHierarchy(cwd)` reader. Inheritance notice: `Enter` continues with the parent, `c` creates a local sub-cline. Unconfigured directories get the two-option wizard (initialize vs scratch session).
  - Scaffolding: `apps/cli/src/utils/workspace-init.ts` → `initializeWorkspace()` writes `.cline/workspace.json`, `.cline/rules/project-rules.md`, and `.cline/skills/`, then refreshes user instructions so the new rules and skills are live without a restart.
  - History scoping: `apps/cli/src/tui/views/history-scoping.ts` (`HistoryScope`, `getNextHistoryScope`, `formatHistoryScopeLabel`) plus `history-view.tsx` (`Tab` cycles `current → hierarchical → all`, "Showing history for: `<layer path>`" header), with the footer hint in `history-export-picker.ts`.
  - `CLINE_DISABLE_WORKSPACE_PROMPT=1` suppresses the launch dialogs; the other TUI suites set it because the dialogs stack over the chat view and swallow scripted keystrokes.
- **Testing (as built)**:
  - Unit: `apps/cli/src/utils/helpers.test.ts` (layering and boundaries), `apps/cli/src/utils/workspace-init.test.ts`, `apps/cli/src/tui/components/dialogs/workspace-onboarding.test.ts`, `apps/cli/src/tui/views/history-scoping.test.ts`.
  - E2E: `apps/cli/src/cli.tuistory.e2e.test.ts` → `describe("cli workspace onboarding (Phase 4)")`: initialize via the default option, create a sub-cline with `c`, continue silently with the parent, and cycle `/history` scopes with `Tab`.
  - **Divergence:** the planned e2e assertion "CLI execution from subfolder verifying parent rules appear in `/rules` or system prompt" was **not** written. Subfolder inheritance is covered instead by the `@cline/core` loader test "inherits ancestor rules and overrides matching filename in child workspace" and by the `paths.test.ts` ordering assertions.

### Phase 5: VS Code Extension Integration (`apps/vscode`, package `claude-dev`) — ✅ Shipped (`807035239`)

Target is `apps/vscode` (package `claude-dev`), **not** `@cline/vscode` (`apps/examples/vscode`).

- **Deliverables (as built)**:
  - **One hierarchy resolution for every host surface** — `apps/vscode/src/sdk/workspace-hierarchy.ts` wraps `resolveHierarchicalWorkspaceSync()` into `resolveWorkspaceHierarchyInfo(targetPath)`, and derives the status bar copy (`formatWorkspaceStatusBar`), the human-readable layer list (`describeWorkspaceHierarchy`), and history scope membership (`matchesWorkspaceHistoryScope`). It imports no `vscode` API, so it is unit-testable outside the extension host, and the traversal itself is never re-implemented in the host.
  - **Status bar indicator** — `apps/vscode/src/hosts/vscode/VscodeWorkspaceStatusBar.ts`, created in `extension.ts` activation and refreshed on `onDidChangeWorkspaceFolders`. Renders `$(folder) Cline: apps-cli` directly and `$(repo) Cline: apps-cli (inherited from monorepo)` when the primary root inherits, with a click quick pick offering `View Workspace Hierarchy`, `Create Local Sub-Cline Override`, and `Open .cline/workspace.json`. It lives in the host layer because the biome `vscode-api` rule forbids direct `vscode` API use in `src/core`.
  - **Webview onboarding card** — `webview-ui/src/components/chat/WorkspaceOnboardingCard.tsx` renders above the chat prompt (first child of `ChatView`'s footer) when `workspaceOnboarding.show` is true, i.e. a folder is open, no workspace exists at or above it, and it has not been dismissed. Backed by the new `initializeWorkspace` / `dismissWorkspaceOnboarding` RPCs (`proto/cline/state.proto`, handlers in `src/core/controller/state/`) and the idempotent scaffolder `apps/vscode/src/sdk/workspace-scaffold.ts`.
  - **History tab scope selector** — `HistoryView.tsx` gains a `Current Project` / `Include Parent` / `All Recent Projects` dropdown (default `All`, matching the previous behavior) that replaces the old `Workspace Only` toggle. It drives a new `optional WorkspaceHistoryScope history_scope` field on `GetTaskHistoryRequest`; `SdkController.getTaskHistory` resolves the hierarchy once per query, filters with `matchesWorkspaceHistoryScope`, and keeps the legacy `current_workspace_only` boolean for callers that leave the field unset.
  - **Webview state** — `ExtensionState` gains `workspaceHierarchy` and `workspaceOnboarding`, computed by `SdkController.getWorkspaceSurfaceState()` and attached in `getStateToPostToWebview()`. The state payload is `State { string state_json }`, so no proto field was needed for these.
  - Dismissals persist in the new global-state key `dismissedWorkspaceOnboardingPath` (backend-only, so the webview only ever sees the computed `show` flag).
- **Testing (as built)**:
  - `bun -F claude-dev test:vitest` — 19 new unit tests in `src/sdk/workspace-hierarchy.test.ts` and `src/sdk/workspace-scaffold.test.ts` (nearest-root-first ordering, inheritance anchors, isolation boundaries, status bar copy, current/hierarchical/all scope matching incl. legacy `cwd` fallback, scaffold idempotency). `vitest.config.ts` owns `src/sdk/**`, in line with the neighbouring SDK-adapter suites; the full `bun -F claude-dev test:vitest` run is 72 files / 1180 tests.
  - `bun -F claude-dev test:unit` — the bun-side suites (`apps/vscode/scripts/run-bun-unit-tests.ts`, 81 files) still pass, since they are untouched by this phase.
  - `bun -F claude-dev test:integration` — a real extension host (`compile-tests && vscode-test`) for multi-root monorepo behavior. Not run in this environment.
- **Divergences from the original plan**:
  - `WorkspaceRootManager` was intentionally **not** rewired to resolve hierarchies. Its `roots` seed `@`-mention/file search and must stay the folders the user actually opened; replacing them with ancestor layers would change search scope. The resolved anchor is tracked as a sibling concept in `SdkController` instead, which is the only thing the status bar, onboarding card, and history scoping need.
  - No extension-side anchor stamping was needed: `SqliteSessionStore.create()` already resolves `anchor_workspace_path` from the session cwd via the Phase 3 resolver, so VS Code sessions are partitioned hierarchically without host changes.
  - History scope filtering happens in `SdkController.getTaskHistory` (in-memory, alongside the existing `currentWorkspaceOnly` filter) rather than as a SQL push-down, because the metadata-history cache is keyed only on `hydrate === false`. Pushing scopes into the store would require extending that cache key first.

---

## 2. Verification & Testing Matrix

| Level | Component | Test Target | Command |
|---|---|---|---|
| **Unit** | `@cline/shared` | Hierarchy resolver, globs, boundary stops, sub-cline discovery | `bun -F @cline/shared test` |
| **Unit** | `@cline/shared` | Layered `resolve*ConfigSearchPaths` ordering & dedup | `bun -F @cline/shared test` |
| **Unit** | `@cline/shared` | `sessions.db` `anchor_workspace_path` column, index & backfill | `bun -F @cline/shared test` |
| **Unit** | `@cline/core` | Multi-layer rule merging, override & watcher hot-reload | `bun -F @cline/core test:unit` |
| **Unit** | `@cline/core` | Scoped history querying (`current` / `hierarchical` / `all`) | `bun -F @cline/core test:unit` |
| **Unit** | `@cline/cli` | `resolveWorkspaceRoot`, scaffolding, onboarding keys, history filters | `bun -F @cline/cli test:unit` |
| **E2E** | `@cline/cli` | Tuistory TUI onboarding, sub-cline creation, `/history` Tab | `bun -F @cline/cli test:e2e:tuistory` |
| **Unit** | `claude-dev` (`apps/vscode`) | `src/sdk` hierarchy, status bar copy, scaffold idempotency, history scope matching | `bun -F claude-dev test:vitest` |
| **Unit** | `claude-dev` (`apps/vscode`) | bun-side suites (`scripts/run-bun-unit-tests.ts`) | `bun -F claude-dev test:unit` |
| **Integration** | `claude-dev` (`apps/vscode`) | Host workspace resolution in a multi-root monorepo | `bun -F claude-dev test:integration` |

Note on invocation form: with bun 1.3.13 the filter form is `bun -F <package> <script>`. Inserting `run` (`bun -F @cline/shared run test:unit`) fails with `error: No packages matched the filter`, and the same error appears for a package that simply lacks the requested script — which is what `bun -F @cline/vscode test:unit` produced, since that package only defines `test`.

---

## 3. Backward Compatibility & Rollout Safety

1. **Zero-Breakage Default**: In single-root repositories, the nearest `.cline` is found immediately at the project root; no ancestor layers exist, producing behavior 100% identical to current Cline. Verified by `workspace.test.ts` → "resolves single-root workspace correctly" and "inherits parent workspace when subfolder has no `.cline`".
2. **Opt-Out Isolation**: Any repository or sub-package can set `"isolated": true` in `.cline/workspace.json` or touch `.cline-boundary` to immediately disable hierarchical resolution. Verified by "enforces isolation boundary when workspace has `isolated: true`" and "enforces isolation boundary via `.cline-boundary` marker file".
3. **Database Fallback**: Rows holding a `NULL`/empty anchor still match through the legacy `(anchor_workspace_path IS NULL AND (workspace_root = ? OR cwd = ?))` predicate, and the lazy backfill only ever writes a resolved `primaryRoot`. `sqlite-db.test.ts` asserts pre-existing rows survive the migration with zero data loss.

---

## 4. Completed Follow-Ups & Edge-Case Resolutions

1. **Phase 1 edge cases implemented & verified** — symlinks, directory loops, unreadable parent directories, and Windows drive roots are handled by `findWorkspaceTraversalStop` / `discoverSubClinesSync` and covered by unit tests in `sdk/packages/shared/src/storage/workspace.test.ts`.
2. **Phase 4 subfolder `/rules` e2e test added** — `apps/cli/src/cli.e2e.test.ts` covers CLI runs inside nested subfolders inheriting parent rules, child basename rule overrides, and isolation boundary enforcement.
3. **Root aggregate scripts updated** — root `package.json` `test` / `test:unit` now covers `apps/vscode` (`bun -F claude-dev test:unit`).
4. **Scaffolder consolidated** — common scaffolding logic extracted to `@cline/shared/storage/workspace-scaffold.ts` (tested by `workspace-scaffold.test.ts`) and re-exported, eliminating duplication between `apps/cli` and `apps/vscode`.
5. **Phase 5 host verification automated** — added real VS Code host integration test suite in `apps/vscode/src/test/workspace-hierarchy-host.test.ts`.
6. **History cache partitioned** — `SdkController.ts` and `sdk-task-history.ts` partition metadata history cache buckets by view `filterKey`, preventing cross-view cache poisoning and keeping filtered page slices full.
7. **Telemetry events wired** — `workspace.resolved`, `workspace.onboarding_initialized`, `workspace.sub_cline_created`, and `workspace.isolation_enabled` privacy-preserving events defined in `core-events.ts` and wired into `workspace-telemetry.ts`.
