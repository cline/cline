/**
 * Hook Response Types
 * Defines the response format from hook executions
 */

/**
 * Hook execution response
 * Hooks can approve, deny, or modify tool executions
 */
export interface HookResponse {
	/**
	 * Whether to allow the action to proceed
	 * - true: Allow execution
	 * - false: Block execution
	 */
	approve: boolean

	/**
	 * Optional message to display to the user
	 * Used for both approval and denial messages
	 */
	message?: string

	/**
	 * Optional modifications to apply to the tool input
	 * Only used for PreToolUse hooks
	 */
	modifiedInput?: unknown

	/**
	 * Optional context to add to the conversation
	 * This will be included in the assistant's context
	 */
	additionalContext?: string

	/**
	 * Optional modifications to the tool output
	 * Only used for PostToolUse hooks
	 */
	modifiedOutput?: unknown
}

/**
 * Hook execution result including metadata
 */
export interface HookExecutionResult {
	/**
	 * The hook response if successful
	 */
	response?: HookResponse

	/**
	 * Error message if the hook failed
	 */
	error?: string

	/**
	 * Exit code from the hook process
	 * - 0: Success/Approve
	 * - Non-zero: Failure/Deny
	 */
	exitCode?: number

	/**
	 * Time taken to execute the hook in milliseconds
	 */
	executionTime?: number

	/**
	 * Whether the hook timed out
	 */
	timedOut?: boolean
}

/**
 * Aggregated result from multiple hooks
 */
export interface AggregatedHookResult {
	/**
	 * Final approval decision (all hooks must approve)
	 */
	approve: boolean

	/**
	 * Combined messages from all hooks
	 */
	messages: string[]

	/**
	 * Merged input modifications (later hooks override earlier ones)
	 */
	modifiedInput?: unknown

	/**
	 * Merged output modifications (later hooks override earlier ones)
	 */
	modifiedOutput?: unknown

	/**
	 * Combined additional context from all hooks
	 */
	additionalContext?: string[]

	/**
	 * Individual results from each hook for debugging
	 */
	individualResults: HookExecutionResult[]
}

/**
 * Default hook response for approval
 */
export const DEFAULT_APPROVE_RESPONSE: HookResponse = {
	approve: true,
}

/**
 * Default hook response for denial
 */
export function createDenyResponse(reason: string): HookResponse {
	return {
		approve: false,
		message: reason,
	}
}

/**
 * Parse hook output into a response
 * Handles both JSON responses and exit codes
 */
export function parseHookOutput(stdout: string, stderr: string, exitCode: number): HookExecutionResult {
	// Non-zero exit code means denial
	if (exitCode !== 0) {
		return {
			response: {
				approve: false,
				message: stderr || `Hook denied with exit code ${exitCode}`,
			},
			exitCode,
		}
	}

	// Try to parse JSON response
	try {
		const response = JSON.parse(stdout) as HookResponse
		return {
			response,
			exitCode: 0,
		}
	} catch {
		// If not JSON, treat as simple approval
		return {
			response: DEFAULT_APPROVE_RESPONSE,
			exitCode: 0,
		}
	}
}

/**
 * Aggregate multiple hook results into a single decision
 */
export function aggregateHookResults(results: HookExecutionResult[]): AggregatedHookResult {
	const messages: string[] = []
	const additionalContext: string[] = []
	let modifiedInput: unknown
	let modifiedOutput: unknown
	let approve = true

	for (const result of results) {
		if (result.error) {
			// Hook execution error counts as denial
			approve = false
			messages.push(`Hook error: ${result.error}`)
			continue
		}

		if (result.timedOut) {
			// Timeout counts as denial
			approve = false
			messages.push("Hook timed out")
			continue
		}

		const response = result.response
		if (!response) {
			continue
		}

		// Any denial means overall denial
		if (!response.approve) {
			approve = false
		}

		// Collect messages
		if (response.message) {
			messages.push(response.message)
		}

		// Collect additional context
		if (response.additionalContext) {
			additionalContext.push(response.additionalContext)
		}

		// Later modifications override earlier ones
		if (response.modifiedInput !== undefined) {
			modifiedInput = response.modifiedInput
		}
		if (response.modifiedOutput !== undefined) {
			modifiedOutput = response.modifiedOutput
		}
	}

	return {
		approve,
		messages,
		modifiedInput,
		modifiedOutput,
		additionalContext: additionalContext.length > 0 ? additionalContext : undefined,
		individualResults: results,
	}
}
