/**
 * Workspace path resolution with migration tracing for multi-workspace support
 *
 * Phase 0: Acts as a tracer to identify all single-root path operations
 * Phase 1+: Will handle multi-root path resolution
 */

import { Logger } from "@services/logging/Logger"
import * as path from "path"
import { WorkspaceRoot } from "./WorkspaceRoot"

/**
 * Tracks path resolution usage for migration planning
 */
interface UsageStats {
	count: number
	examples: string[]
	lastUsed: Date
}

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
			const cwd = cwdOrRoots

			// Track usage for migration planning
			if (context) {
				this.trackUsage(context, relativePath)

				// Phase 0: Just wrap existing behavior
				const result = path.resolve(cwd, relativePath)

				if (this.traceEnabled) {
					Logger.debug(`[MULTI-ROOT-TRACE] ${context}: resolving "${relativePath}" against "${cwd}"`)
				}

				return result
			}

			// Phase 0: Just wrap existing behavior
			return path.resolve(cwd, relativePath)
		}

		// Phase 1+: Multi-root resolution (placeholder for future)
		const workspaceRoots = cwdOrRoots

		// If absolute path, just return it with matching root
		if (path.isAbsolute(relativePath)) {
			const matchingRoot = workspaceRoots.find((root) => relativePath.startsWith(root.path))
			return {
				absolutePath: relativePath,
				root: matchingRoot || workspaceRoots[0], // fallback to primary
			}
		}

		// Check which roots have this relative path
		const candidateRoots: WorkspaceRoot[] = []
		for (const root of workspaceRoots) {
			// const testPath = path.join(root.path, relativePath)
			// In Phase 1, check if path exists
			// For now, just add all roots as candidates
			candidateRoots.push(root)
		}

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
		const entries = Array.from(this.usageMap.entries()).sort((a, b) => b[1].count - a[1].count) // Sort by usage count

		let report = "=== Multi-Root Migration Report ===\n"
		report += `Total components using single-root: ${entries.length}\n`
		report += `Trace enabled: ${this.traceEnabled}\n\n`

		let totalCalls = 0

		entries.forEach(([context, stats]) => {
			totalCalls += stats.count

			report += `${context}:\n`
			report += `  Calls: ${stats.count}\n`
			report += `  Last used: ${stats.lastUsed.toISOString()}\n`

			if (stats.examples.length > 0) {
				report += `  Example paths:\n`
				stats.examples.forEach((ex) => {
					report += `    - "${ex}"\n`
				})
			}
			report += "\n"
		})

		// Summary Section
		report += `\n=== Summary ===\n`
		report += `Total path resolution calls: ${totalCalls}\n`

		// Identify high-usage components
		const highUsageComponents = entries
			.filter(([_, stats]) => stats.count > 100)
			.map(([context, stats]) => ({ context, count: stats.count }))

		if (highUsageComponents.length > 0) {
			report += `\n=== High-Usage Components ===\n`
			report += `(Operations with >100 calls)\n`
			highUsageComponents.forEach((h) => {
				report += `  - ${h.context}: ${h.count} calls\n`
			})
		}

		return report
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
			Logger.debug(`[MULTI-ROOT-TRACE] ${context}: getting basename for "${filePath}"`)
		}

		return result
	}
}

// Export singleton instance
export const workspaceResolver = new WorkspaceResolver()

/**
 * Phase 0: Convenience function for easy migration from path.resolve()
 * This is what we'll use to replace existing path.resolve(cwd, ...) calls
 */
export function resolveWorkspacePath(cwd: string, relativePath: string, context?: string): string {
	return workspaceResolver.resolveWorkspacePath(cwd, relativePath, context) as string
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
