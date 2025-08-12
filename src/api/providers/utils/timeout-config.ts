import * as vscode from "vscode"

/**
 * Gets the API request timeout from VSCode configuration with validation.
 *
 * @returns The timeout in milliseconds. Returns 0 for no timeout.
 */
export function getApiRequestTimeout(): number {
	// Get timeout with validation to ensure it's a valid non-negative number
	const configTimeout = vscode.workspace.getConfiguration("roo-cline").get<number>("apiRequestTimeout", 600)

	// Validate that it's actually a number and not NaN
	if (typeof configTimeout !== "number" || isNaN(configTimeout)) {
		return 600 * 1000 // Default to 600 seconds
	}

	// Allow 0 (no timeout) but clamp negative values to 0
	const timeoutSeconds = configTimeout < 0 ? 0 : configTimeout

	return timeoutSeconds * 1000 // Convert to milliseconds
}
