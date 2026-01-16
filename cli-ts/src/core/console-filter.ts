/**
 * Console output filtering for CLI mode
 *
 * Intercepts all console methods (log, info, debug, warn, error) to suppress
 * noisy operational messages unless verbose mode is enabled.
 *
 * This must be called EARLY in CLI startup, before any other code runs,
 * to ensure all console output is filtered.
 */

// Store original console methods for restoration
const originalConsole = {
	log: console.log,
	info: console.info,
	debug: console.debug,
	warn: console.warn,
	error: console.error,
}

// Patterns that indicate noisy operational output
export const NOISE_PATTERNS = [
	// Telemetry & Feature Flags
	"Telemetry distinct ID",
	"Changing telemetry ID",
	"TelemetryService",
	"TelemetryProviderFactory",
	"NoOpTelemetryProvider",
	"NoOpFeatureFlagsProvider",
	"NoOpErrorProvider",
	"identifyUser",

	// Storage & Migration
	"Storage Migration",
	"FileContextTracker",

	// Checkpoints & Git Operations
	"CheckpointTracker",
	"checkpoint",
	"Checkpoint",
	"Repository ID",
	"cwdHash",
	"shadow git",
	"Shadow git",
	"Getting diff count between commits",
	"diff count",

	// Task & Lock Management
	"Lock manager not available",
	"Task lock",
	"Skipping Checkpoints lock",
	"Todo file watcher",
	"[Task",

	// Workspace & Terminal
	"WorkspaceManager",
	"TerminalManager",
	"StandaloneTerminalRegistry",
	"StandaloneTerminal",

	// Focus Chain
	"focus chain",
	"Focus Chain",

	// Server & Initialization
	"#bot.cline.server.ts",
	"instantiated",
	"for legacy",

	// Registry
	"Registry health check",

	// Debug markers
	"[DEBUG]",
	"[OTEL",

	// MCP
	"[MCP",

	// Component warnings that are not errors
	"Component '",
	"Warning: Component",

	// Controller lifecycle (not actual errors)
	"Controller disposed",
]

/**
 * Check if a message should be suppressed based on noise patterns
 */
function shouldSuppress(args: unknown[]): boolean {
	const message = args.map(String).join(" ")
	return NOISE_PATTERNS.some((pattern) => message.includes(pattern))
}

/**
 * Apply console filtering to suppress noisy output
 *
 * @param verbose - If true, no filtering is applied (all output shown)
 */
export function applyConsoleFilter(verbose: boolean): void {
	if (verbose) {
		// In verbose mode, restore original methods (no filtering)
		restoreConsole()
		return
	}

	// Replace console methods with filtered versions
	console.log = (...args: unknown[]) => {
		if (!shouldSuppress(args)) {
			originalConsole.log.apply(console, args)
		}
	}

	console.info = (...args: unknown[]) => {
		if (!shouldSuppress(args)) {
			originalConsole.info.apply(console, args)
		}
	}

	console.warn = (...args: unknown[]) => {
		if (!shouldSuppress(args)) {
			originalConsole.warn.apply(console, args)
		}
	}

	console.error = (...args: unknown[]) => {
		if (!shouldSuppress(args)) {
			originalConsole.error.apply(console, args)
		}
	}

	// Always suppress debug in non-verbose mode
	console.debug = () => {
		// No-op
	}
}

/**
 * Restore original console methods
 *
 * Useful for testing or when verbose mode is toggled
 */
export function restoreConsole(): void {
	console.log = originalConsole.log
	console.info = originalConsole.info
	console.debug = originalConsole.debug
	console.warn = originalConsole.warn
	console.error = originalConsole.error
}
