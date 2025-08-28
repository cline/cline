/**
 * Utility for lazy-loading the VS Code module in environments where it's available.
 * This allows the SDK to be used in both VS Code extension and Node.js environments.
 * Compatible with both VSCode and Cursor extension hosts.
 */

let vscodeModule: typeof import("vscode") | undefined

/**
 * Attempts to dynamically import the VS Code module.
 * Returns undefined if not running in a VS Code/Cursor extension context.
 */
export async function importVscode(): Promise<typeof import("vscode") | undefined> {
	// Check if already loaded
	if (vscodeModule) {
		return vscodeModule
	}

	try {
		// Method 1: Check if vscode is available in global scope (common in extension hosts).
		if (typeof globalThis !== "undefined" && "acquireVsCodeApi" in globalThis) {
			// We're in a webview context, vscode module won't be available.
			return undefined
		}

		// Method 2: Try to require the module (works in most extension contexts).
		if (typeof require !== "undefined") {
			try {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				vscodeModule = require("vscode")

				if (vscodeModule) {
					return vscodeModule
				}
			} catch (error) {
				console.error("Error loading VS Code module:", error)
				// Fall through to dynamic import.
			}
		}

		// Method 3: Dynamic import (original approach, works in VSCode).
		vscodeModule = await import("vscode")
		return vscodeModule
	} catch (error) {
		// Log the original error for debugging.
		console.warn("VS Code module not available in this environment:", error)
		return undefined
	}
}
