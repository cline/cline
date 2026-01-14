/**
 * Suppress noisy console output during module initialization.
 * This file must be imported first (before any other imports) to take effect.
 *
 * This prevents variant configuration warnings and other debug logs from cluttering the CLI.
 */

// Save original console methods
const originalConsoleWarn = console.warn
const originalConsoleLog = console.log
const originalConsoleError = console.error

// Patterns of messages we want to suppress in non-verbose mode
const suppressedPatterns = [
	/variant configuration warnings/i,
	/BannerService/i,
	/TelemetryProviderFactory/i,
	/TelemetryService/i,
	/NoOpTelemetryProvider/i,
	/Telemetry ID/i,
	/Telemetry distinct ID/i,
	/WorkspaceManager/i,
	/CheckpointTracker/i,
	/checkpoint/i,
	/shadow git/i,
	/Lock manager/i,
	/Task lock/i,
	/Registry health check/i,
	/Component.*not found/i,
	/\[CLI\]/i,
	/punycode.*deprecated/i,
	/No user found/i,
	/authentication data found/i,
	/legacy checkpoints/i,
	/ClineProvider instantiated/i,
	/CommandExecutor/i,
	/StandaloneTerminalManager/i,
	/Using HostProvider/i,
	/Cline API Error/i,
]

function shouldSuppress(args: unknown[]): boolean {
	const message = args.map((a) => String(a)).join(" ")
	return suppressedPatterns.some((pattern) => pattern.test(message))
}

// Check if we're in verbose mode by looking at command line args
const isVerboseMode = process.argv.includes("-v") || process.argv.includes("--verbose")

if (!isVerboseMode) {
	console.warn = (...args: unknown[]) => {
		if (!shouldSuppress(args)) {
			originalConsoleWarn.apply(console, args as [unknown?, ...unknown[]])
		}
	}
	console.log = (...args: unknown[]) => {
		if (!shouldSuppress(args)) {
			originalConsoleLog.apply(console, args as [unknown?, ...unknown[]])
		}
	}
	// Keep errors visible but filter some noisy ones
	console.error = (...args: unknown[]) => {
		if (!shouldSuppress(args)) {
			originalConsoleError.apply(console, args as [unknown?, ...unknown[]])
		}
	}
}

// Export a function to restore original console methods if needed
export function restoreConsole() {
	console.warn = originalConsoleWarn
	console.log = originalConsoleLog
	console.error = originalConsoleError
}
