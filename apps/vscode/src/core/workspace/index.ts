/**
 * Workspace module exports for multi-workspace support
 */

// Export workspace path parsing utilities
export { getWorkspaceBasename, workspaceResolver } from "./WorkspaceResolver"
export { WorkspaceRootManager } from "./WorkspaceRootManager"
// Re-export convenience function at module level for easier imports
// Usage: import { resolveWorkspacePath } from "@core/workspace"
