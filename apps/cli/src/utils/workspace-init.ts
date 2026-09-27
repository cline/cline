// RFC 0001 (hierarchical workspaces) — Phase 4 workspace scaffolding.
//
// The implementation lives once in @cline/shared/storage (shared with the VS Code
// extension's Phase 5 scaffolder). This module re-exports it under the CLI's
// historical names so the TUI onboarding dialog and its tests keep importing
// from here.

export {
	initializeWorkspaceLayout as initializeWorkspace,
	type InitializeWorkspaceLayoutOptions as InitializeWorkspaceOptions,
	type InitializeWorkspaceLayoutResult as InitializedWorkspaceResult,
} from "@cline/shared/storage";
