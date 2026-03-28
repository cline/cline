/**
 * Mode selection logic for CLI - determines whether to use Ink (interactive) or plain text mode
 *
 * This is extracted as a pure function for testability. The decision tree:
 * - Plain text mode when output is redirected (stdout not TTY)
 * - Plain text mode when input is redirected (stdin not TTY) - Ink requires raw mode
 * - Plain text mode when stdin was piped (e.g., echo "x" | cline)
 * - Plain text mode when --json flag is used
 * - Plain text mode when --yolo flag is used
 * - Otherwise: Interactive Ink mode
 */

export interface ModeSelectionInput {
	/** Is stdout connected to a TTY (interactive terminal)? */
	stdoutIsTTY: boolean
	/** Is stdin connected to a TTY (interactive terminal)? */
	stdinIsTTY: boolean
	/** Was stdin piped (FIFO or file), even if empty? */
	stdinWasPiped: boolean
	/** --json flag for machine-readable output */
	json?: boolean
	/** --yolo flag for auto-approve mode */
	yolo?: boolean
}

export interface ModeSelectionResult {
	/** Use plain text mode instead of Ink */
	usePlainTextMode: boolean
	/** Reason for the mode selection (for telemetry/debugging) */
	reason: "interactive" | "yolo_flag" | "json" | "piped_stdin" | "stdin_redirected" | "stdout_redirected"
}

/**
 * Determine whether to use plain text mode or interactive Ink mode
 *
 * @param input - Environment and option flags
 * @returns Mode selection result with reason
 */
export function selectOutputMode(input: ModeSelectionInput): ModeSelectionResult {
	// Priority order matters - check most specific flags first

	if (input.yolo) {
		return { usePlainTextMode: true, reason: "yolo_flag" }
	}

	if (input.json) {
		return { usePlainTextMode: true, reason: "json" }
	}

	if (input.stdinWasPiped) {
		return { usePlainTextMode: true, reason: "piped_stdin" }
	}

	if (!input.stdinIsTTY) {
		return { usePlainTextMode: true, reason: "stdin_redirected" }
	}

	if (!input.stdoutIsTTY) {
		return { usePlainTextMode: true, reason: "stdout_redirected" }
	}

	return { usePlainTextMode: false, reason: "interactive" }
}
