import { CommandExitError, CommandSpawnError } from "@cline/core"

/** Telemetry dimensions for one failed background (`child_process`) execution. */
export interface BackgroundFailureDimensions {
	/** The process ran and exited non-zero. */
	exitCode?: number
	/**
	 * The process never produced an exit code, and why: the operating system
	 * code when the shell could not be started (`ENOENT` when it is not on
	 * PATH, `EACCES`, `EFTYPE`), `ENOENT_CWD` when the working directory had
	 * vanished instead, `aborted` when the turn was cancelled, or `other`.
	 */
	errorCode?: string
}

/**
 * Classifies the error a background executor rejected with, so a failure that
 * produced no exit code is still labelled in `task.terminal_execution`. Without
 * this, "the shell is missing" was indistinguishable from an abort or a
 * closed terminal in the same success=false bucket.
 */
export function describeBackgroundFailure(error: unknown): BackgroundFailureDimensions {
	if (error instanceof CommandExitError) {
		return { exitCode: error.exitCode }
	}
	if (error instanceof CommandSpawnError) {
		// spawn says ENOENT for a missing executable and for a missing working
		// directory alike; the error already checked which, so keep them apart.
		if (error.missing === "cwd") {
			return { errorCode: "ENOENT_CWD" }
		}
		return { errorCode: error.code ?? "spawn" }
	}
	if (error instanceof Error && (error.name === "AbortError" || /\baborted\b/i.test(error.message))) {
		return { errorCode: "aborted" }
	}
	return { errorCode: "other" }
}
