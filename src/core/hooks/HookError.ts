/**
 * Types of errors that can occur during hook execution
 */
export enum HookErrorType {
	/** Hook execution exceeded the timeout limit */
	TIMEOUT = "timeout",
	/** Hook output failed JSON validation */
	VALIDATION = "validation",
	/** Hook script execution failed (non-zero exit, crash, etc.) */
	EXECUTION = "execution",
	/** Hook was cancelled by user */
	CANCELLATION = "cancellation",
}

/**
 * Structured error information for hook failures.
 * Provides both user-friendly messages and technical details.
 */
export interface HookErrorInfo {
	/** Type of error that occurred */
	type: HookErrorType
	/** User-friendly error message */
	message: string
	/** Technical details for debugging (optional, shown in expansion) */
	details?: string
	/** Path to the hook script that failed */
	scriptPath?: string
	/** Exit code if available */
	exitCode?: number
	/** Stderr output if available */
	stderr?: string
}

/**
 * Error thrown during hook execution with structured information.
 * This allows proper error handling without string parsing.
 */
export class HookExecutionError extends Error {
	constructor(
		public readonly errorInfo: HookErrorInfo,
		message?: string,
	) {
		super(message || errorInfo.message)
		this.name = "HookExecutionError"
	}

	/**
	 * Check if an error is a HookExecutionError
	 */
	static isHookError(error: unknown): error is HookExecutionError {
		return error instanceof HookExecutionError
	}

	/**
	 * Create a timeout error
	 */
	static timeout(scriptPath: string, timeoutMs: number, stderr?: string, hookName?: string): HookExecutionError {
		const hookPrefix = hookName ? `${hookName} hook` : "Hook"
		return new HookExecutionError({
			type: HookErrorType.TIMEOUT,
			message: `${hookPrefix} execution timed out after ${timeoutMs}ms`,
			details:
				`The hook took longer than ${timeoutMs / 1000} seconds to complete.\n\n` +
				`Common causes:\n` +
				`• Infinite loop in hook script\n` +
				`• Network request hanging without timeout\n` +
				`• File I/O operation stuck\n` +
				`• Heavy computation taking too long\n\n` +
				`Recommendations:\n` +
				`1. Check your hook script for infinite loops\n` +
				`2. Add timeouts to network requests\n` +
				`3. Use background jobs for long operations\n` +
				`4. Test your hook script independently`,
			scriptPath,
			stderr,
		})
	}

	/**
	 * Create a validation error
	 */
	static validation(validationError: string, scriptPath: string, stdoutPreview: string): HookExecutionError {
		return new HookExecutionError({
			type: HookErrorType.VALIDATION,
			message: "Hook output validation failed",
			details: `${validationError}\n\nOutput preview:\n${stdoutPreview}`,
			scriptPath,
		})
	}

	/**
	 * Create an execution error
	 */
	static execution(scriptPath: string, exitCode: number, stderr?: string, hookName?: string): HookExecutionError {
		const hookPrefix = hookName ? `${hookName} hook` : "Hook script"
		const message = `${hookPrefix} exited with code ${exitCode}`
		return new HookExecutionError(
			{
				type: HookErrorType.EXECUTION,
				message,
				details: stderr ? `stderr:\n${stderr}` : undefined,
				scriptPath,
				exitCode,
				stderr,
			},
			message,
		)
	}

	/**
	 * Create a cancellation error
	 */
	static cancellation(scriptPath: string, hookName?: string): HookExecutionError {
		const hookPrefix = hookName ? `${hookName} hook` : "Hook"
		return new HookExecutionError({
			type: HookErrorType.CANCELLATION,
			message: `${hookPrefix} execution was cancelled`,
			details: "The hook was cancelled by the user before completion",
			scriptPath,
			exitCode: 130, // Standard SIGINT exit code
		})
	}
}
