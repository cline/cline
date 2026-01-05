/**
 * Platform-specific shell escaping utilities for hook script paths.
 * Ensures paths with spaces and special characters work correctly when
 * executed through a shell (shell: true in spawn).
 */

/**
 * Escapes a path for safe use in a Windows shell command.
 * Handles spaces, quotes, and other special characters.
 *
 * Windows shell (cmd.exe) rules:
 * - Wrap path in double quotes
 * - Escape double quotes by doubling them ("")
 * - Backslashes before quotes need to be doubled
 *
 * @param path The file path to escape
 * @returns The escaped path safe for Windows shell execution
 */
function escapeWindowsShellPath(path: string): string {
	// Escape backslashes that precede quotes
	let escaped = path.replace(/\\"/g, '\\\\"')
	// Escape standalone double quotes by doubling them
	escaped = escaped.replace(/"/g, '""')
	// Wrap in double quotes
	return `"${escaped}"`
}

/**
 * Escapes a path for safe use in a Unix shell command (sh, bash, zsh).
 * Handles spaces, quotes, apostrophes, and other special characters.
 *
 * Unix shell rules:
 * - Wrap path in single quotes (safest for most characters)
 * - Single quotes inside path are escaped as '\''
 *   (close quote, escaped quote, open quote)
 *
 * @param path The file path to escape
 * @returns The escaped path safe for Unix shell execution
 */
function escapeUnixShellPath(path: string): string {
	// Replace single quotes with '\'' (close quote, escaped quote, open quote)
	const escaped = path.replace(/'/g, "'\\''")
	// Wrap in single quotes
	return `'${escaped}'`
}

/**
 * Escapes a file path for safe shell execution on any platform.
 * This is critical when using spawn() with shell: true and paths that
 * may contain spaces or special characters.
 *
 * Use cases:
 * - Global hooks directory: ~/Documents/Cline/Hooks/
 * - Workspace hooks: /path/to/My Project/.clinerules/hooks/
 * - Multi-root workspaces: each root's .clinerules/hooks/
 *
 * Examples:
 * - "/Users/user/My Project/hooks/PreToolUse" → "'/Users/user/My Project/hooks/PreToolUse'"
 * - "C:\Users\user\My Project\hooks\PreToolUse" → '"C:\Users\user\My Project\hooks\PreToolUse"'
 * - "/path/with 'quotes'/hooks/PreToolUse" → "'/path/with '\''quotes'\'' /hooks/PreToolUse'"
 *
 * @param path The file path to escape
 * @returns The escaped path safe for shell execution on the current platform
 */
export function escapeShellPath(path: string): string {
	return process.platform === "win32" ? escapeWindowsShellPath(path) : escapeUnixShellPath(path)
}
