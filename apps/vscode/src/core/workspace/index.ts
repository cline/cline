/**
 * Workspace module exports for multi-workspace support
 */

// Export workspace path parsing utilities
export type { ParsedWorkspacePath } from "./utils/parseWorkspaceInlinePath"
export {
	addWorkspaceHint,
	hasWorkspaceHint,
	parseMultipleWorkspacePaths,
	parseWorkspaceInlinePath,
	removeWorkspaceHint,
} from "./utils/parseWorkspaceInlinePath"
export type { WorkspaceAdapterConfig } from "./WorkspacePathAdapter"
export { createWorkspacePathAdapter, WorkspacePathAdapter } from "./WorkspacePathAdapter"
export {
	getWorkspaceBasename,
	isWorkspaceTraceEnabled,
	resolveWorkspacePath,
	WorkspaceResolver,
	workspaceResolver,
} from "./WorkspaceResolver"
export type { WorkspaceContext } from "./WorkspaceRootManager"
export { createLegacyWorkspaceRoot, WorkspaceRootManager } from "./WorkspaceRootManager"

// Re-export convenience function at module level for easier imports
// Usage: import { resolveWorkspacePath } from "@core/workspace"
