/**
 * Console management for CLI
 *
 * Captures original console methods BEFORE any core modules are imported,
 * so CLI output works even when console.log is suppressed.
 */

// Capture original console methods immediately
export const originalConsoleLog = console.log.bind(console)
export const originalConsoleError = console.error.bind(console)
export const originalConsoleWarn = console.warn.bind(console)
export const originalConsoleInfo = console.info.bind(console)
export const originalConsoleDebug = console.debug.bind(console)

/**
 * Suppress console output unless verbose mode is enabled.
 *
 * This is intentionally opt-in and should only be called by the CLI entrypoint.
 * Library consumers should not have their global console methods mutated as a
 * side effect of importing the library bundle.
 */
export function suppressConsoleUnlessVerbose(argv: string[] = process.argv) {
	const isVerbose = argv.includes("-v") || argv.includes("--verbose")
	if (isVerbose) {
		return
	}

	console.log = () => {}
	console.warn = () => {}
	console.error = () => {}
	console.debug = () => {}
	console.info = () => {}
}

/**
 * Restore original console methods (for cleanup)
 */
export function restoreConsole() {
	console.log = originalConsoleLog
	console.error = originalConsoleError
	console.warn = originalConsoleWarn
	console.info = originalConsoleInfo
	console.debug = originalConsoleDebug
}
