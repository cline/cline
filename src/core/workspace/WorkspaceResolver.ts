/**
 * Workspace path resolution with migration tracing for multi-workspace support
 *
 * Phase 0: Acts as a tracer to identify all single-root path operations
 * Phase 1+: Will handle multi-root path resolution
 */

import { WorkspaceRoot } from "@shared/multi-root/types"
import * as path from "path"
import { MigrationReporter, type UsageStats } from "./MigrationReporter"
import { parseWorkspaceInlinePath } from "./utils/parseWorkspaceInlinePath"
import { WorkspacePathAdapter } from "./WorkspacePathAdapter"

/**
 * Maximum number of example paths to store per component for debugging purposes.
 * This limit prevents excessive memory usage while providing enough examples
 * to understand usage patterns during migration analysis.
 */
const MAX_EXAMPLE_PATHS = 5

export class WorkspaceResolver {
	private usageMap = new Map<string, UsageStats>()
	private traceEnabled = process.env.MULTI_ROOT_TRACE === "true" || process.env.NODE_ENV === "development"

	/**
	 * Track usage statistics for a given context and path
	 * @param context - Component/handler name for tracking usage
	 * @param examplePath - The path to track as an example
	 */
	private trackUsage(context: string, examplePath: string): void {
		const stats = this.usageMap.get(context) || {
			count: 0,
			examples: [],
			lastUsed: new Date(),
		}

		stats.count++
		stats.lastUsed = new Date()

		// Keep up to MAX_EXAMPLE_PATHS example paths for debugging
		if (stats.examples.length < MAX_EXAMPLE_PATHS && !stats.examples.includes(examplePath)) {
			stats.examples.push(examplePath)
		}

		this.usageMap.set(context, stats)
	}

	/**
	 * Phase 0: Traces single-root path resolution for migration planning
	 * Phase 1+: Will resolve path against multiple workspace roots
	 *
	 * @param cwdOrRoots - Current working directory (Phase 0) or array of workspace roots (Phase 1+)
	 * @param relativePath - The relative path to resolve
	 * @param context - Component/handler name for tracking usage
	 * @returns Absolute path (Phase 0) or object with path and root (Phase 1+)
	 */
	resolveWorkspacePath(
		cwdOrRoots: string | WorkspaceRoot[],
		relativePath: string,
		context?: string,
	): string | { absolutePath: string; root: WorkspaceRoot } {
		// Phase 0: Single-root tracer mode
		if (typeof cwdOrRoots === "string") {
			return this.resolveSingleRootPath(cwdOrRoots, relativePath, context)
		}

		// Phase 1+: Multi-root resolution
		return this.resolveMultiRootPath(cwdOrRoots, relativePath)
	}

	/**
	 * Resolves a path against a single workspace root (Phase 0)
	 *
	 * @param cwd - Current working directory
	 * @param relativePath - The relative path to resolve
	 * @param context - Component/handler name for tracking usage
	 * @returns Absolute path
	 */
	private resolveSingleRootPath(cwd: string, relativePath: string, context?: string): string {
		// Track usage for migration planning
		if (context) {
			this.trackUsage(context, relativePath)

			if (this.traceEnabled) {
				console.debug(`[MULTI-ROOT-TRACE] ${context}: resolving "${relativePath}" against "${cwd}"`)
			}
		}

		return path.resolve(cwd, relativePath)
	}

	/**
	 * Resolves a path against multiple workspace roots (Phase 1+)
	 *
	 * @param workspaceRoots - Array of workspace roots
	 * @param relativePath - The relative path to resolve
	 * @returns Object with absolute path and matching root
	 */
	private resolveMultiRootPath(
		workspaceRoots: WorkspaceRoot[],
		relativePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		// Handle absolute paths
		if (path.isAbsolute(relativePath)) {
			return this.resolveAbsolutePath(workspaceRoots, relativePath)
		}

		// Handle relative paths
		return this.resolveRelativePath(workspaceRoots, relativePath)
	}

	/**
	 * Resolves an absolute path against workspace roots
	 *
	 * @param workspaceRoots - Array of workspace roots
	 * @param absolutePath - The absolute path to resolve
	 * @returns Object with absolute path and matching root
	 */
	private resolveAbsolutePath(
		workspaceRoots: WorkspaceRoot[],
		absolutePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		const matchingRoot = workspaceRoots.find((root) => absolutePath.startsWith(root.path))
		return {
			absolutePath,
			root: matchingRoot || workspaceRoots[0], // fallback to primary
		}
	}

	/**
	 * Resolves a relative path against workspace roots
	 *
	 * @param workspaceRoots - Array of workspace roots
	 * @param relativePath - The relative path to resolve
	 * @returns Object with absolute path and matching root
	 */
	private resolveRelativePath(
		workspaceRoots: WorkspaceRoot[],
		relativePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		// Check which roots have this relative path
		const candidateRoots: WorkspaceRoot[] = []
		for (const root of workspaceRoots) {
			// const testPath = path.join(root.path, relativePath)
			// In Phase 1, check if path exists
			// For now, just add all roots as candidates
			candidateRoots.push(root)
		}

		return this.selectBestRoot(workspaceRoots, candidateRoots, relativePath)
	}

	/**
	 * Selects the best root from candidate roots using disambiguation logic
	 *
	 * @param workspaceRoots - All available workspace roots
	 * @param candidateRoots - Candidate roots that could contain the path
	 * @param relativePath - The relative path being resolved
	 * @returns Object with absolute path and selected root
	 */
	private selectBestRoot(
		workspaceRoots: WorkspaceRoot[],
		candidateRoots: WorkspaceRoot[],
		relativePath: string,
	): { absolutePath: string; root: WorkspaceRoot } {
		// Disambiguation logic (simplified for Phase 0)
		if (candidateRoots.length === 0) {
			// Path doesn't exist in any root, use primary
			return {
				absolutePath: path.resolve(workspaceRoots[0].path, relativePath),
				root: workspaceRoots[0],
			}
		}

		if (candidateRoots.length === 1) {
			// Unambiguous
			return {
				absolutePath: path.resolve(candidateRoots[0].path, relativePath),
				root: candidateRoots[0],
			}
		}

		// Multiple matches - need disambiguation
		// Phase 2: This will trigger UI picker
		// For now, use primary root if it's a candidate, otherwise first match
		const primaryRoot = workspaceRoots[0]
		const selectedRoot = candidateRoots.find((r) => r.path === primaryRoot.path) || candidateRoots[0]

		return {
			absolutePath: path.resolve(selectedRoot.path, relativePath),
			root: selectedRoot,
		}
	}

	/**
	 * Get migration report showing all single-root usage patterns
	 * Currently this function is mainly called by the vscode debugger
	 */
	getMigrationReport(): string {
		const reporter = new MigrationReporter()
		return reporter.generateReport(this.usageMap, this.traceEnabled)
	}

	/**
	 * Get raw usage statistics for external analysis
	 * @returns Map of component names to their usage statistics
	 */
	getUsageStats(): Map<string, UsageStats> {
		return new Map(this.usageMap)
	}

	/**
	 * Clear usage statistics (useful for testing)
	 */
	clearUsageStats(): void {
		this.usageMap.clear()
	}

	/**
	 * Export usage data as JSON for analysis
	 */
	exportUsageData(): Record<string, UsageStats> {
		return Object.fromEntries(this.usageMap)
	}

	/**
	 * Phase 0: Instance method for getting basename with tracking
	 * Phase 1+: Will handle basename for multi-workspace paths
	 *
	 * @param filePath - The file path to get basename from
	 * @param context - Component/handler name for tracking usage
	 * @returns The basename of the path
	 */
	getBasename(filePath: string, context?: string): string {
		// Track usage for migration planning
		if (!context?.length) {
			return path.basename(filePath)
		}
		this.trackUsage(context, filePath)

		// Phase 0: Just wrap existing behavior
		const result = path.basename(filePath)

		if (this.traceEnabled) {
			console.debug(`[MULTI-ROOT-TRACE] ${context}: getting basename for "${filePath}"`)
		}

		return result
	}
}

// Export singleton instance
export const workspaceResolver = new WorkspaceResolver()

/**
 * Result type for multi-root workspace path resolution
 */
export interface WorkspacePathResult {
	absolutePath: string
	displayPath: string
	resolvedPath: string
}

/**
 * Configuration for workspace path resolution
 */
export interface WorkspaceConfig {
	cwd: string
	isMultiRootEnabled?: boolean
	workspaceManager?: any
}

/**
 * Enhanced workspace path resolution that handles both single and multi-root workspaces
 *
 * @param cwdOrConfig - Either a string (for backward compatibility) or a config object
 * @param relativePath - The relative path to resolve
 * @param context - Component/handler name for tracking usage
 * @returns Either a string (for backward compatibility) or a WorkspacePathResult object
 */
export function resolveWorkspacePath(
	cwdOrConfig: string | WorkspaceConfig,
	relativePath: string,
	context?: string,
): string | WorkspacePathResult {
	// Backward compatibility: if first param is a string, return string
	if (typeof cwdOrConfig === "string") {
		return workspaceResolver.resolveWorkspacePath(cwdOrConfig, relativePath, context) as string
	}

	// New behavior: handle multi-root workspaces
	const config = cwdOrConfig

	// If multi-root is enabled and we have a workspace manager
	if (config.isMultiRootEnabled && config.workspaceManager) {
		// Parse workspace hint from the path (e.g., @frontend:src/index.ts)
		const { workspaceHint, relPath: parsedPath } = parseWorkspaceInlinePath(relativePath)

		// Create adapter for multi-workspace path resolution
		const adapter = new WorkspacePathAdapter({
			cwd: config.cwd,
			isMultiRootEnabled: true,
			workspaceManager: config.workspaceManager,
		})

		// Resolve to the correct workspace root
		const absolutePath = adapter.resolvePath(parsedPath, workspaceHint)

		// Build display path with workspace hint if present
		const displayPath = workspaceHint ? `@${workspaceHint}:${parsedPath}` : parsedPath

		return {
			absolutePath,
			displayPath,
			resolvedPath: parsedPath,
		}
	}

	// Fallback to single-workspace behavior
	const absolutePath = workspaceResolver.resolveWorkspacePath(config.cwd, relativePath, context) as string

	return {
		absolutePath,
		displayPath: relativePath,
		resolvedPath: relativePath,
	}
}

/**
 * Helper to check if we're in trace mode
 */
export function isWorkspaceTraceEnabled(): boolean {
	return process.env.MULTI_ROOT_TRACE === "true" || process.env.NODE_ENV === "development"
}

/**
 * Phase 0: Convenience function for path.basename with tracking
 * This is what we'll use to replace existing path.basename() calls
 */
export function getWorkspaceBasename(filePath: string, context?: string): string {
	return workspaceResolver.getBasename(filePath, context)
}
