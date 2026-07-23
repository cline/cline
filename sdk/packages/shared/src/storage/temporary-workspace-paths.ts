export const CLINE_WORKSPACES_DIRECTORY_NAME = "workspaces";
export const CLINE_WORKSPACE_PROJECT_DIRECTORY_NAME = "project";

// Default data-dir anchors for the structural check below. The Node resolver
// derives the real location from resolveClineDataDir(), which defaults to
// `~/.cline/data`.
const CLINE_CONFIG_DIRECTORY_NAME = ".cline";
const CLINE_DATA_DIRECTORY_NAME = "data";

const WORKSPACE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Browser-safe structural check for an SDK-created pathless-session workspace
 * root: `.cline/data/workspaces/<session-id>/project`. Matches the default
 * data-dir layout only; explicit `CLINE_DATA_DIR` overrides are not detectable
 * from a bare path string.
 */
export function isTemporaryWorkspacePath(path: string): boolean {
	const normalizedPath = path.trim();
	const isWindowsAbsolute =
		/^[A-Za-z]:[\\/]/.test(normalizedPath) || normalizedPath.startsWith("\\\\");
	const isPosixAbsolute = normalizedPath.startsWith("/");
	if (!isWindowsAbsolute && !isPosixAbsolute) {
		return false;
	}
	const segments = normalizedPath
		.split(isWindowsAbsolute ? /[\\/]+/ : /\/+/)
		.filter(Boolean);
	const projectDirectory = segments.at(-1) ?? "";
	const sessionId = segments.at(-2) ?? "";
	const workspacesDirectory = segments.at(-3) ?? "";
	const dataDirectory = segments.at(-4) ?? "";
	const configDirectory = segments.at(-5) ?? "";
	return (
		configDirectory === CLINE_CONFIG_DIRECTORY_NAME &&
		dataDirectory === CLINE_DATA_DIRECTORY_NAME &&
		workspacesDirectory === CLINE_WORKSPACES_DIRECTORY_NAME &&
		WORKSPACE_SESSION_ID_PATTERN.test(sessionId) &&
		projectDirectory === CLINE_WORKSPACE_PROJECT_DIRECTORY_NAME
	);
}
