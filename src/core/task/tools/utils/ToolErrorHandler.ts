import { ToolUse } from "../../../assistant-message"
import { ToolValidationUtils } from "./ToolValidationUtils"

/**
 * Centralized error handling for tool execution
 */
export class ToolErrorHandler {
	/**
	 * Handle validation errors and parameter validation
	 */
	static async handleValidationError(
		block: ToolUse,
		result: any,
		config: any,
		pushToolResult: (content: any, block: ToolUse) => void,
		saveCheckpoint: () => Promise<void>,
		sayAndCreateMissingParamError: (toolName: any, paramName: string) => Promise<any>,
	): Promise<boolean> {
		// Check for missing path parameter (common across file tools)
		if (!block.params.path && ToolErrorHandler.requiresPathParameter(block.name)) {
			config.taskState.consecutiveMistakeCount++
			pushToolResult(await sayAndCreateMissingParamError(block.name, "path"), block)
			await saveCheckpoint()
			return true // Error was handled
		}

		// Check if handler returned a validation error
		if (ToolValidationUtils.isValidationError(result)) {
			pushToolResult(result, block)
			await saveCheckpoint()
			return true // Error was handled
		}

		return false // No error to handle
	}

	/**
	 * Check if a tool requires a path parameter
	 */
	private static requiresPathParameter(toolName: string): boolean {
		const pathRequiredTools = [
			"read_file",
			"write_to_file",
			"replace_in_file",
			"new_rule",
			"list_files",
			"list_code_definition_names",
			"search_files",
		]
		return pathRequiredTools.includes(toolName)
	}

	/**
	 * Handle diff view reset on tool rejection
	 */
	static async handleDiffViewReset(config: any): Promise<void> {
		await config.services.diffViewProvider.revertChanges()
		await config.services.diffViewProvider.reset()
	}
}
