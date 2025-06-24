/**
 * Platform-specific command transformation utilities
 * Handles cases where commands need shell execution on Windows
 */

/**
 * Node.js package managers that require shell execution on Windows
 */
const NODE_SHELL_COMMANDS = ["npx", "npm", "yarn", "pnpm"] as const

/**
 * Transforms command and args for Windows compatibility
 * @param command The command to execute
 * @param args The command arguments
 * @returns Transformed command and args that work cross-platform
 */
export function transformCommandForPlatform(command: string, args: string[] = []): { command: string; args: string[] } {
	// Only transform on Windows
	if (process.platform !== "win32") {
		return { command, args }
	}

	// Check if this command needs shell execution on Windows
	if (NODE_SHELL_COMMANDS.includes(command as any)) {
		return {
			command: "cmd",
			args: ["/c", command, ...args],
		}
	}

	// Return unchanged for other commands
	return { command, args }
}

/**
 * Checks if a command would be transformed on the current platform
 * Useful for logging/debugging purposes
 */
export function isCommandTransformed(command: string): boolean {
	return process.platform === "win32" && NODE_SHELL_COMMANDS.includes(command as any)
}
