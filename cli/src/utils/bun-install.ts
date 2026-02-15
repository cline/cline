import { realpathSync } from "node:fs"

/**
 * Normalize a script path for installer detection.
 * Resolves symlinks when possible, then normalizes path separators.
 */
export function normalizeScriptPath(
	scriptPath: string,
	resolvePath: (path: string) => string = (path) => realpathSync(path),
): string {
	if (!scriptPath) {
		return ""
	}

	try {
		return resolvePath(scriptPath).replace(/\\/g, "/")
	} catch {
		return scriptPath.replace(/\\/g, "/")
	}
}

/**
 * Detect whether the current script path looks like a Bun global installation.
 * Covers both direct Bun bin invocations and resolved symlink targets.
 */
export function isBunGlobalInstallPath(scriptPath: string, resolvePath?: (path: string) => string): boolean {
	const normalizedPath = normalizeScriptPath(scriptPath, resolvePath)
	return normalizedPath.includes("/.bun/bin/") || normalizedPath.includes("/.bun/install/global/node_modules/cline/")
}
