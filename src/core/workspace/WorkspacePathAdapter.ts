/**
 * WorkspacePathAdapter - Utility for resolving paths in single or multi-workspace environments
 *
 * This adapter provides a unified interface for path resolution that works with both
 * single-root (legacy) and multi-root workspace configurations. It encapsulates the
 * logic for determining which workspace a path belongs to and resolving relative paths
 * to their absolute equivalents.
 */

import * as path from "path"
import { resolveWorkspacePath } from "./WorkspaceResolver"
import type { WorkspaceRootManager } from "./WorkspaceRootManager"

export interface WorkspaceAdapterConfig {
	cwd: string
	isMultiRootEnabled?: boolean
	workspaceManager?: WorkspaceRootManager
}

export class WorkspacePathAdapter {
	constructor(private config: WorkspaceAdapterConfig) {}

	/**
	 * Resolves a path using either single-root or multi-root logic
	 *
	 * @param relativePath - The path to resolve (can be relative or absolute)
	 * @param workspaceHint - Optional hint for which workspace to use (name or path)
	 * @returns The resolved absolute path
	 */
	resolvePath(relativePath: string, workspaceHint?: string): string {
		// Single-root mode (backward compatible)
		if (!this.config.isMultiRootEnabled || !this.config.workspaceManager) {
			return resolveWorkspacePath(this.config.cwd, relativePath, "WorkspacePathAdapter") as string
		}

		// Multi-root mode
		const manager = this.config.workspaceManager as WorkspaceRootManager

		// If absolute path, find which workspace it belongs to
		if (path.isAbsolute(relativePath)) {
			// Already absolute, just validate it belongs to a workspace
			const root = manager.resolvePathToRoot(relativePath)
			if (!root) {
				// Path doesn't belong to any workspace, but return it anyway
				console.warn(`[WorkspacePathAdapter] Absolute path ${relativePath} doesn't belong to any workspace`)
			}
			return relativePath
		}

		// If hint provided, try to use that workspace
		if (workspaceHint) {
			// Try by name first
			let root = manager.getRootByName(workspaceHint)

			// If not found by name, try to find a root that contains the hint path
			if (!root) {
				const roots = manager.getRoots()
				root = roots.find((r) => r.path === workspaceHint || r.path.includes(workspaceHint))
			}

			if (root) {
				// If no relative path specified, return the workspace root itself
				if (!relativePath) {
					return root.path
				}
				return path.join(root.path, relativePath)
			}

			console.warn(`[WorkspacePathAdapter] Workspace hint '${workspaceHint}' not found, using primary workspace`)
		}

		// Default to primary workspace
		const primaryRoot = manager.getPrimaryRoot()
		if (primaryRoot) {
			// If no relative path specified, return the workspace root itself
			if (!relativePath) {
				return primaryRoot.path
			}
			return path.join(primaryRoot.path, relativePath)
		}

		// Fallback to cwd if no roots (shouldn't happen, but defensive)
		console.warn(`[WorkspacePathAdapter] No workspace roots found, falling back to cwd`)
		return resolveWorkspacePath(this.config.cwd, relativePath, "WorkspacePathAdapter-fallback") as string
	}

	/**
	 * Gets all possible paths for a relative path across all workspaces
	 * Useful for search operations or when checking if a file exists in any workspace
	 *
	 * @param relativePath - The relative path to resolve
	 * @returns Array of absolute paths, one for each workspace
	 */
	getAllPossiblePaths(relativePath: string): string[] {
		// Single-root mode
		if (!this.config.isMultiRootEnabled || !this.config.workspaceManager) {
			return [resolveWorkspacePath(this.config.cwd, relativePath, "WorkspacePathAdapter-getAllPaths") as string]
		}

		// Multi-root mode
		const manager = this.config.workspaceManager as WorkspaceRootManager
		return manager.getRoots().map((root) => path.join(root.path, relativePath))
	}

	/**
	 * Determines which workspace a given absolute path belongs to
	 *
	 * @param absolutePath - The absolute path to check
	 * @returns The workspace root that contains this path, or undefined if not in any workspace
	 */
	getWorkspaceForPath(absolutePath: string): { name: string; path: string } | undefined {
		// Single-root mode
		if (!this.config.isMultiRootEnabled || !this.config.workspaceManager) {
			// In single-root, check if path is within cwd
			if (absolutePath.startsWith(this.config.cwd)) {
				return {
					name: path.basename(this.config.cwd),
					path: this.config.cwd,
				}
			}
			return undefined
		}

		// Multi-root mode
		const manager = this.config.workspaceManager as WorkspaceRootManager
		const root = manager.resolvePathToRoot(absolutePath)
		if (root) {
			return {
				name: root.name || path.basename(root.path),
				path: root.path,
			}
		}

		return undefined
	}

	/**
	 * Gets the relative path from the appropriate workspace root
	 *
	 * @param absolutePath - The absolute path to make relative
	 * @returns The relative path from its workspace root, or the original path if not in a workspace
	 */
	getRelativePath(absolutePath: string): string {
		// Single-root mode
		if (!this.config.isMultiRootEnabled || !this.config.workspaceManager) {
			if (absolutePath.startsWith(this.config.cwd)) {
				return path.relative(this.config.cwd, absolutePath)
			}
			return absolutePath
		}

		// Multi-root mode
		const manager = this.config.workspaceManager as WorkspaceRootManager
		const relativePath = manager.getRelativePathFromRoot(absolutePath)
		return relativePath || absolutePath
	}

	/**
	 * Checks if multi-root mode is enabled
	 *
	 * @returns True if multi-root mode is enabled and configured
	 */
	isMultiRootEnabled(): boolean {
		return !!(this.config.isMultiRootEnabled && this.config.workspaceManager)
	}

	/**
	 * Gets all workspace roots
	 *
	 * @returns Array of workspace root information
	 */
	getWorkspaceRoots(): Array<{ name: string; path: string }> {
		// Single-root mode
		if (!this.config.isMultiRootEnabled || !this.config.workspaceManager) {
			return [
				{
					name: path.basename(this.config.cwd),
					path: this.config.cwd,
				},
			]
		}

		// Multi-root mode
		const manager = this.config.workspaceManager as WorkspaceRootManager
		return manager.getRoots().map((root) => ({
			name: root.name || path.basename(root.path),
			path: root.path,
		}))
	}

	/**
	 * Gets the primary workspace root
	 *
	 * @returns The primary workspace root information
	 */
	getPrimaryWorkspace(): { name: string; path: string } {
		// Single-root mode
		if (!this.config.isMultiRootEnabled || !this.config.workspaceManager) {
			return {
				name: path.basename(this.config.cwd),
				path: this.config.cwd,
			}
		}

		// Multi-root mode
		const manager = this.config.workspaceManager as WorkspaceRootManager
		const primaryRoot = manager.getPrimaryRoot()
		if (primaryRoot) {
			return {
				name: primaryRoot.name || path.basename(primaryRoot.path),
				path: primaryRoot.path,
			}
		}

		// Fallback (shouldn't happen)
		return {
			name: path.basename(this.config.cwd),
			path: this.config.cwd,
		}
	}
}

/**
 * Factory function to create a WorkspacePathAdapter
 *
 * @param config - The task configuration
 * @returns A new WorkspacePathAdapter instance
 */
export function createWorkspacePathAdapter(config: WorkspaceAdapterConfig): WorkspacePathAdapter {
	return new WorkspacePathAdapter(config)
}
