export function resolveWorkspaceRootPath(paths: readonly string[] | undefined, noWorkspaceFallback: string): string {
	return paths?.find((workspacePath) => workspacePath.trim().length > 0) ?? noWorkspaceFallback
}

/**
 * Resolve the paths used to seed the WorkspaceRootManager.
 *
 * Returns the host's non-empty workspace folder paths when available. When the
 * host reports no workspace folders (e.g. an empty VS Code window), falls back
 * to `noWorkspaceFallback` so callers still get a usable single-root manager.
 * This mirrors the legacy Controller, whose setupWorkspaceManager() always
 * seeded the manager via getCwd(getDesktopDir()). Without the fallback,
 * @-mention file search in an empty window returns zero results and emits
 * task.mention_failed (workspace_unavailable) — see searchFiles.ts.
 */
export function resolveWorkspaceManagerPaths(
	paths: readonly string[] | undefined,
	noWorkspaceFallback: string | undefined,
): string[] {
	const validPaths = (paths ?? []).filter((workspacePath) => workspacePath.trim().length > 0)
	if (validPaths.length > 0) {
		return validPaths
	}
	const fallback = noWorkspaceFallback?.trim()
	return fallback ? [fallback] : []
}
