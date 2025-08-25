import * as vscode from "vscode"

/**
 * Gets terminal environment variables from VS Code settings based on the current platform
 */
export function getTerminalEnvironmentVariables(): Record<string, string> {
	try {
		const config = vscode.workspace.getConfiguration("terminal.integrated")
		const platform = process.platform

		let envKey: string
		if (platform === "win32") {
			envKey = "env.windows"
		} else if (platform === "darwin") {
			envKey = "env.osx"
		} else {
			envKey = "env.linux"
		}

		const terminalEnv = config.get<Record<string, string>>(envKey) || {}
		return terminalEnv
	} catch (error) {
		console.warn("Failed to get terminal environment variables:", error)
		return {}
	}
}

/**
 * Substitutes environment variable placeholders in the format ${env:VARIABLE_NAME}
 * with actual environment variable values. Checks VS Code terminal.integrated.env first,
 * then falls back to system environment variables.
 */
export function substituteEnvironmentVariables(content: string): string {
	// Get terminal environment variables from VS Code settings
	const terminalEnv = getTerminalEnvironmentVariables()

	return content.replace(/\$\{env:([^}]+)\}/g, (match, variableName) => {
		// First check terminal.integrated.env settings
		if (terminalEnv[variableName] !== undefined) {
			return terminalEnv[variableName]
		}

		// Fallback to system environment variables
		const envValue = process.env[variableName]
		if (envValue !== undefined) {
			return envValue
		}

		console.warn(
			`Environment variable "${variableName}" is not defined in terminal.integrated.env or system environment, keeping placeholder: ${match}`,
		)
		return match
	})
}
