export function resolveWorkspaceRootPath(paths: readonly string[] | undefined, noWorkspaceFallback: string): string {
	return paths?.find((workspacePath) => workspacePath.trim().length > 0) ?? noWorkspaceFallback
}
