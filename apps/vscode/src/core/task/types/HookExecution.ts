/**
 * Represents an active hook execution that can be cancelled.
 * This is tracked in TaskState to allow cancellation via UI or programmatic triggers.
 */
export interface HookExecution {
	/** The name of the hook being executed (e.g., "PreToolUse", "PostToolUse") */
	hookName: string
	/** The name of the tool that triggered this hook (for PreToolUse/PostToolUse hooks) */
	toolName?: string
	/** The timestamp of the message showing hook execution status */
	messageTs: number
	/** The abort controller used to cancel the hook execution */
	abortController: AbortController
}
