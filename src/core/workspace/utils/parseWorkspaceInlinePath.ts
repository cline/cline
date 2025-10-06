/**
 * parseWorkspaceInlinePath - Utility for parsing workspace-prefixed paths
 *
 * This utility extracts workspace hints from paths using the @workspace:path syntax.
 * This allows tools to target specific workspaces in multi-root environments.
 *
 * Examples:
 *   "@frontend:src/index.ts" -> { workspaceHint: "frontend", relPath: "src/index.ts" }
 *   "@backend:package.json" -> { workspaceHint: "backend", relPath: "package.json" }
 *   "src/index.ts" -> { workspaceHint: undefined, relPath: "src/index.ts" }
 *   "@my-app:src/components/Button.tsx" -> { workspaceHint: "my-app", relPath: "src/components/Button.tsx" }
 */

export interface ParsedWorkspacePath {
	/**
	 * The workspace hint extracted from the path (if any)
	 * This can be a workspace name or partial path to match
	 */
	workspaceHint?: string

	/**
	 * The relative path after removing the workspace prefix
	 */
	relPath: string
}

/**
 * Parse a path that may contain a workspace hint prefix
 *
 * @param value - The input path that may contain @workspace: prefix
 * @returns Parsed result with optional workspace hint and the relative path
 */
export function parseWorkspaceInlinePath(value: string): ParsedWorkspacePath {
	// Handle null/undefined/empty inputs
	if (!value) {
		return { workspaceHint: undefined, relPath: value || "" }
	}

	// Regex to match @workspace:path pattern
	// Captures:
	// - Group 1: workspace name (anything except colon)
	// - Group 2: the path after the colon
	const match = value.match(/^@([^:]+):(.*)$/)

	if (match) {
		const [, workspaceHint, relPath] = match
		return {
			workspaceHint: workspaceHint.trim(),
			relPath: relPath.trim(),
		}
	}

	// No workspace hint found, return original value as relative path
	return { workspaceHint: undefined, relPath: value }
}

/**
 * Check if a path contains a workspace hint
 *
 * @param value - The path to check
 * @returns True if the path contains a workspace hint
 */
export function hasWorkspaceHint(value: string): boolean {
	return /^@[^:]+:/.test(value)
}

/**
 * Add a workspace hint to a path
 *
 * @param workspaceName - The workspace name to add as hint
 * @param path - The relative path
 * @returns The path with workspace hint prefix
 */
export function addWorkspaceHint(workspaceName: string, path: string): string {
	// Remove any existing hint first
	const { relPath } = parseWorkspaceInlinePath(path)
	return `@${workspaceName}:${relPath}`
}

/**
 * Remove workspace hint from a path if present
 *
 * @param value - The path that may contain a workspace hint
 * @returns The path without workspace hint
 */
export function removeWorkspaceHint(value: string): string {
	const { relPath } = parseWorkspaceInlinePath(value)
	return relPath
}

/**
 * Parse multiple paths that may contain workspace hints
 * Useful for batch operations
 *
 * @param paths - Array of paths that may contain workspace hints
 * @returns Array of parsed results
 */
export function parseMultipleWorkspacePaths(paths: string[]): ParsedWorkspacePath[] {
	return paths.map((path) => parseWorkspaceInlinePath(path))
}
