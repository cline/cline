export const BEDROCK_CODER_WORKSPACES_DIRECTORY_NAME = "workspaces";
export const BEDROCK_CODER_CHAT_WORKSPACE_DIRECTORY_NAME = "chat";

// Default data-dir anchors for the structural check below. The Node resolver
// derives the real location from resolveBedrockCoderDataDir(), which defaults to
// `~/.bedrock-coder/data`.
const BEDROCK_CODER_CONFIG_DIRECTORY_NAME = ".bedrock-coder";
const BEDROCK_CODER_DATA_DIRECTORY_NAME = "data";

/**
 * Browser-safe structural check for the shared chat workspace that hosts
 * sessions started without a project: `.bedrock-coder/data/workspaces/chat`. Matches
 * the directory itself only — project folders created inside it are regular
 * workspaces. Matches the default data-dir layout; explicit `BEDROCK_CODER_DATA_DIR`
 * overrides are not detectable from a bare path string.
 */
export function isChatWorkspacePath(path: string): boolean {
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
	const chatDirectory = segments.at(-1) ?? "";
	const workspacesDirectory = segments.at(-2) ?? "";
	const dataDirectory = segments.at(-3) ?? "";
	const configDirectory = segments.at(-4) ?? "";
	return (
		configDirectory === BEDROCK_CODER_CONFIG_DIRECTORY_NAME &&
		dataDirectory === BEDROCK_CODER_DATA_DIRECTORY_NAME &&
		workspacesDirectory === BEDROCK_CODER_WORKSPACES_DIRECTORY_NAME &&
		chatDirectory === BEDROCK_CODER_CHAT_WORKSPACE_DIRECTORY_NAME
	);
}
