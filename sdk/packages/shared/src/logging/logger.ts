/**
 * Cross-package logging surface for hosts that inject their own logger (for example `pino` or the VS Code API).
 *
 * {@link BasicLogger.debug} is for verbose diagnostics (hosts typically gate this behind a debug log level).
 * {@link BasicLogger.log} is the primary channel for operational messages that are not errors.
 * {@link BasicLogger.error} is optional; when omitted, hosts may route failures through {@link BasicLogger.log}
 * with {@link BasicLogMetadata.severity} `"error"` or handle errors elsewhere.
 *
 * Use {@link noopBasicLogger} when you need a fully-defined no-op implementation.
 */

/**
 * Optional structured fields used across the SDK and recommended for host log backends.
 * Callers may add other keys freely; these names are the shared convention for cross-component queries.
 */
export interface BasicLogMetadata extends Record<string, unknown> {
	sessionId?: string;
	runId?: string;
	providerId?: string;
	toolName?: string;
	durationMs?: number;
	/**
	 * When using {@link BasicLogger.log}, disambiguates severity for backends that map a single `log`
	 * method onto multiple output levels (for example Pino `info` vs `warn`).
	 */
	severity?: "info" | "warn" | "error";
}

export interface BasicLogger {
	/** Verbose diagnostics; hosts should no-op or filter when not in debug mode. */
	debug: (message: string, metadata?: BasicLogMetadata) => void;
	/** Operational messages (replaces former `info` / non-error `warn` split). */
	log: (message: string, metadata?: BasicLogMetadata) => void;
	error?: (
		message: string,
		metadata?: BasicLogMetadata & { error?: unknown },
	) => void;
}

/** All levels implemented as no-ops; safe default when no logger is injected. */
export const noopBasicLogger: BasicLogger = {
	debug: () => {},
	log: () => {},
	error: () => {},
};
