/**
 * Workspace module exports for multi-workspace support
 */

export {
	getWorkspaceBasename,
	isWorkspaceTraceEnabled,
	resolveWorkspacePath,
	WorkspaceResolver,
	workspaceResolver,
} from "@core/workspace/WorkspaceResolver"
export type { WorkspaceRoot } from "@core/workspace/WorkspaceRoot"
export { VcsType } from "@core/workspace/WorkspaceRoot"
export type { WorkspaceContext } from "@core/workspace/WorkspaceRootManager"
export { createLegacyWorkspaceRoot, WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"

// Re-export convenience function at module level for easier imports
// Usage: import { resolveWorkspacePath } from "@core/workspace"
