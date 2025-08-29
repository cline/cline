/**
 * Utility for lazy-loading the VS Code module in environments where it's available.
 * This allows the SDK to be used in both VS Code extension and Node.js environments.
 * Compatible with both VSCode and Cursor extension hosts.
 */

let vscodeModule: typeof import("vscode") | undefined

/**
 * Attempts to dynamically import the `vscode` module.
 * Returns undefined if not running in a VSCode extension context.
 */
export async function importVscode(): Promise<typeof import("vscode") | undefined> {
	if (vscodeModule) {
		return vscodeModule
	}

	try {
		if (typeof require !== "undefined") {
			try {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				vscodeModule = require("vscode")

				if (vscodeModule) {
					console.log("VS Code module loaded from require")
					return vscodeModule
				}
			} catch (error) {
				console.error(`Error loading VS Code module: ${error instanceof Error ? error.message : String(error)}`)
				// Fall through to dynamic import.
			}
		}

		vscodeModule = await import("vscode")
		console.log("VS Code module loaded from dynamic import")
		return vscodeModule
	} catch (error) {
		console.warn(
			`VS Code module not available in this environment: ${error instanceof Error ? error.message : String(error)}`,
		)

		return undefined
	}
}
