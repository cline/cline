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

// Check for verbose flag early (before commander parses)
const isVerbose = process.argv.includes("-v") || process.argv.includes("--verbose")

// Suppress console output unless verbose mode
if (!isVerbose) {
	console.log = () => {}
	console.warn = () => {}
}

/**
 * Restore original console methods (for cleanup)
 */
export function restoreConsole() {
	console.log = originalConsoleLog
	console.error = originalConsoleError
	console.warn = originalConsoleWarn
}
