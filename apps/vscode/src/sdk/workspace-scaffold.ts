// RFC 0001 (hierarchical workspaces) — Phase 5 workspace scaffolding.
//
// The implementation lives once in @cline/shared/storage (Phase 4 CLI and Phase 5
// VS Code must not drift). This module re-exports it under the historical
// VS Code names so the SdkController, the status bar, and the vitest suite keep
// importing from here.

export {
	DEFAULT_WORKSPACE_PROJECT_RULES as DEFAULT_PROJECT_RULES,
	type InitializeWorkspaceLayoutOptions,
	type InitializeWorkspaceLayoutResult,
	initializeWorkspaceLayout,
} from "@cline/shared/storage"
