/**
 * Utilities for harvesting workspace-relative path intent from tool calls.
 *
 * These are used by ToolExecutor.harvestRulePathIntent() and unit-tested in
 * src/core/task/__tests__/harvestRulePathIntent.test.ts.
 */

export type WorkspaceRoot = { path: string }

/**
 * Normalize an absolute path to workspace-relative, using the provided roots.
 * Returns the original path if no root matches or if the path is already relative.
 */
export function normalizeToWorkspaceRelative(candidate: string, roots: WorkspaceRoot[]): string {
	if (!candidate) return candidate

	const isAbs = candidate.startsWith("/") || /^[A-Za-z]:\\/.test(candidate)
	if (!isAbs || roots.length === 0) {
		return candidate
	}

	for (const root of roots) {
		if (!root?.path) continue
		const absPosix = candidate.replace(/\\/g, "/")
		const rootPosix = root.path.replace(/\\/g, "/").replace(/\/$/, "")
		if (!absPosix.startsWith(rootPosix + "/")) continue
		const relPath = absPosix.slice(rootPosix.length + 1)
		if (relPath) {
			return relPath
		}
	}

	return candidate
}

/**
 * Extract paths from write_to_file, replace_in_file, or new_rule tool params.
 */
export function extractPathsFromWriteTool(params: { path?: string; absolutePath?: string }): string[] {
	const paths: string[] = []
	if (params.path) paths.push(params.path)
	if (params.absolutePath) paths.push(params.absolutePath)
	return paths
}

/**
 * Parse apply_patch input to extract target file paths from patch headers.
 * Matches lines like: *** Add File: path/to/file.ts
 */
export function extractPathsFromApplyPatch(input: string): string[] {
	if (typeof input !== "string" || !input) return []

	const paths: string[] = []
	const fileHeaderRegex = /^\*\*\* (?:Add|Update|Delete) File: (.+?)(?:\n|$)/gm
	let m: RegExpExecArray | null
	while ((m = fileHeaderRegex.exec(input))) {
		const filePath = (m[1] || "").trim()
		if (filePath) {
			paths.push(filePath)
		}
	}
	return paths
}

/**
 * Validate and normalize a path candidate for rule intent collection.
 * Returns undefined if the path should be rejected.
 */
export function validateAndNormalizePath(candidate: string): string | undefined {
	if (!candidate) return undefined
	const posix = candidate.replace(/\\/g, "/").replace(/^\//, "")
	if (!posix || posix === "/") return undefined
	// Reject directory traversal like "../foo" or "foo/.." but allow valid filenames like "file..txt".
	if (posix.split("/").some((segment) => segment === "..")) return undefined
	return posix
}
