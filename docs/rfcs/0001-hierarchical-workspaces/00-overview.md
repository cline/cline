# RFC 0001: Hierarchical Workspaces, Layered Configuration & Scoped Context

- **RFC Number:** 0001
- **Title:** Hierarchical Workspaces, Layered Configuration & Scoped Context
- **Author:** Antigravity (on behalf of Cline Community)
- **Status:** Proposed (Draft)
- **Created:** 2026-09-27
- **Target Packages:** `@cline/shared`, `@cline/core`, `@cline/cli`, `apps/vscode` (package `claude-dev`; note the workspace package `@cline/vscode` is `apps/examples/vscode`)

---

## 1. Executive Summary

Today, Cline models workspaces as flat, single-directory roots based strictly on the immediate directory passed to the host (e.g. `process.cwd()` in CLI or `vscode.workspace.workspaceFolders[0]` in VS Code). In monorepos, multi-package repositories, and microservice architectures, this model causes critical failures:
1. **Configuration Disconnection**: Opening any subfolder (e.g. `apps/cli` in the `cline` repo) silently drops all repository-root rules (`.cline/rules`, `.clinerules`, `AGENTS.md`), skills (`.cline/skills`, `.agents/skills`), agents, and workflows.
2. **Context & History Pollution**: Task history stored in SQLite `sessions.db` is queried globally without project scoping, resulting in cluttered session lists across unrelated projects or fragmented history across submodules.
3. **Absence of Onboarding / Initialization UX**: When developers open an unconfigured folder, Cline provides no guided flow to inherit existing parent workspaces or scaffold project settings.

This RFC introduces a **Hierarchical Workspace Architecture** centered on:
- **Nearest-Root-First Resolution**: The nearest ancestor `.cline` directory becomes the primary active workspace.
- **Layered Inheritance**: Ancestor `.cline` directories layer beneath the primary root, flowing shared organizational rules and skills downward with leaf-level overrides.
- **Explicit Workspace Manifests**: Support for `includes` (registering recognized sub-clines/packages) and `ignores` (excluding paths or establishing isolation boundaries).
- **Partitioned Context & History**: Session history and memories are cleanly scoped to the resolved workspace.
- **Interactive Onboarding**: Guided setup when opening unconfigured directories or nested monorepo subprojects.

---

## 2. Motivation: The Monorepo Problem

Consider a standard monorepo such as `cline` itself:
```text
cline/
├── .cline/
│   ├── workspace.json         # Root workspace config (includes, ignores)
│   ├── rules/
│   │   ├── typescript.md      # Repo-wide conventions
│   │   └── security.md
│   └── skills/
│       └── release-checks/
├── AGENTS.md                  # Repo-wide agent instructions
├── apps/
│   ├── cli/
│   │   ├── .cline/            # Sub-cline for CLI-specific rules
│   │   │   └── rules/
│   │   │       └── tui-ux.md
│   │   └── src/               <-- Developer launches Cline here
│   └── vscode/
└── sdk/
    └── packages/
```

### Current Deficiencies:
- **Rule Loss**: Working inside `apps/cli/src` loads neither `cline/AGENTS.md` nor `cline/.cline/rules/typescript.md`. The model operates without repo standards unless the developer launches Cline exclusively from the repo root.
- **Unstructured Multi-Root Handling**: The current `WorkspaceRootManager` in VS Code inspects only the top-level folders provided by the VS Code window, with no upward resolution to the containing Git root or parent `.cline`.
- **Global History Mixing**: Session records in `~/.cline/data/db/sessions.db` record raw `cwd` and `workspace_root` strings, but default history queries (`SELECT session_id FROM sessions ORDER BY started_at DESC`) lack workspace partitioning.

---

## 3. Core Architectural Principles

In accordance with John Ousterhout’s *A Philosophy of Software Design*:
1. **Reader-Centric & Obvious**: Developers should not need to configure complex environment variables or manually replicate rule files across nested packages. Like Git (`.git`) and package managers (`package.json`), Cline should automatically resolve context hierarchically.
2. **Deep Interfaces**: The core hierarchical resolution is encapsulated behind a clean, single-call function (`resolveHierarchicalWorkspace(startPath, options)`) in `@cline/shared` and `@cline/core`. Host surfaces (CLI, VS Code, Desktop, Hub) consume this abstraction without reimplementing filesystem traversal.
3. **Zero Change Amplification**: Adding or updating an organization rule at the monorepo root automatically propagates to every sub-package without requiring edits in downstream directories.

---

## 4. RFC Document Map

This RFC is organized into modular specifications:
- **[01. Resolution & Layering Specification](./01-resolution-and-layering.md)**: Upward resolution algorithm, stopping boundaries, ancestor layering, and `workspace.json` schema (`includes`, `ignores`, `isolated`).
- **[02. Scoped Context & Storage Specification](./02-scoped-context-and-storage.md)**: Database schema updates, `anchor_workspace_path`, history query scoping, rule override precedence, and instruction merging.
- **[03. Onboarding & User Experience](./03-onboarding-and-ux.md)**: CLI TUI workflows, VS Code status bar and webview onboarding, notification copy, and error handling.
- **[04. Phased Implementation Roadmap & Verification](./04-phased-implementation-roadmap.md)**: Phasing from shared core to host surfaces, test strategies, and backward compatibility assurances.
