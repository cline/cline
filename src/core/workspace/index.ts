/**
 * Workspace module exports for multi-workspace support
 */

export {
	getWorkspaceBasename,
	isWorkspaceTraceEnabled,
	resolveWorkspacePath,
	WorkspaceResolver,
	workspaceResolver,
} from "./WorkspaceResolver"
export type { WorkspaceRoot } from "./WorkspaceRoot"
export { VcsType } from "./WorkspaceRoot"
export type { WorkspaceContext } from "./WorkspaceRootManager"
export { createLegacyWorkspaceRoot, WorkspaceRootManager } from "./WorkspaceRootManager"

// Re-export convenience function at module level for easier imports
// Usage: import { resolveWorkspacePath } from "@core/workspace"
