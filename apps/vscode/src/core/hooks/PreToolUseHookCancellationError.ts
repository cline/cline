/**
 * Error thrown when a PreToolUse hook requests cancellation.
 * This signals to the tool handler that execution should be aborted.
 */
export class PreToolUseHookCancellationError extends Error {
	constructor(message: string = "PreToolUse hook requested cancellation") {
		super(message)
		this.name = "PreToolUseHookCancellationError"
	}
}
