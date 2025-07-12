/**
 * Detects if we're running in a VS Code extension context
 * @returns true if running in VS Code extension, false if in standalone Electron app
 */
export function isVSCodeExtension(): boolean {
	try {
		// The most reliable way to detect VS Code extension context is to check
		// for the presence of the 'vscode' module, which is exclusively available
		// within the VS Code extension host environment
		require("vscode")
		return true
	} catch {
		// If we can't require the vscode module, we're in standalone Electron
		return false
	}
}

/**
 * Detects if we're running in a standalone Electron app
 * @returns true if running in standalone Electron, false if in VS Code extension
 */
export function isElectronStandalone(): boolean {
	return !isVSCodeExtension()
}
