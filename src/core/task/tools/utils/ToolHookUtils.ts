import type { ToolUse } from "@core/assistant-message"
import { PreToolUseHookCancellationError } from "@core/hooks/PreToolUseHookCancellationError"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Utility functions for tool hook execution.
 */
export class ToolHookUtils {
	/**
	 * Runs the PreToolUse hook if enabled.
	 *
	 * This should be called by tool handlers after approval succeeds
	 * but before the actual tool execution begins.
	 *
	 * @param config Task configuration containing optional preToolUseRunner
	 * @param block The tool use block being executed
	 * @returns true to continue execution, false if hook cancelled
	 *
	 * @example
	 * // After approval logic
	 * const shouldContinue = await ToolHookUtils.runPreToolUseIfEnabled(config, block)
	 * if (!shouldContinue) {
	 *     return formatResponse.toolCancelled()
	 * }
	 * // Continue with execution...
	 */
	static async runPreToolUseIfEnabled(config: TaskConfig, block: ToolUse): Promise<boolean> {
		if (!config.preToolUseRunner) {
			return true // Hooks disabled, continue
		}

		try {
			await config.preToolUseRunner.run()
			return true // Hook succeeded, continue
		} catch (error) {
			if (error instanceof PreToolUseHookCancellationError) {
				return false // Hook cancelled, stop
			}
			// Other errors should propagate
			throw error
		}
	}
}
