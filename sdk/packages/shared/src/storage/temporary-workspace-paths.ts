export const CLINE_TEMPORARY_WORKSPACE_ROOT_DIRECTORY = "cline";
export const CLINE_TEMPORARY_WORKSPACE_SESSIONS_DIRECTORY = "sessions";
export const CLINE_TEMPORARY_WORKSPACE_SESSION_DIRECTORY_SUFFIX = "-temp";
export const CLINE_TEMPORARY_WORKSPACE_PROJECT_DIRECTORY = "project";

const TEMPORARY_WORKSPACE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Browser-safe structural check for an SDK-created temporary workspace root. */
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
	const sessionDirectory = segments.at(-2) ?? "";
	const sessionsDirectory = segments.at(-3) ?? "";
	const rootDirectory = segments.at(-4) ?? "";
	const sessionId = sessionDirectory.endsWith(
		CLINE_TEMPORARY_WORKSPACE_SESSION_DIRECTORY_SUFFIX,
	)
		? sessionDirectory.slice(
				0,
				-CLINE_TEMPORARY_WORKSPACE_SESSION_DIRECTORY_SUFFIX.length,
			)
		: "";
	return (
		rootDirectory === CLINE_TEMPORARY_WORKSPACE_ROOT_DIRECTORY &&
		sessionsDirectory === CLINE_TEMPORARY_WORKSPACE_SESSIONS_DIRECTORY &&
		TEMPORARY_WORKSPACE_SESSION_ID_PATTERN.test(sessionId) &&
		projectDirectory === CLINE_TEMPORARY_WORKSPACE_PROJECT_DIRECTORY
	);
}
