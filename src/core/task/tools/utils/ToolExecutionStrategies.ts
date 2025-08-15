import { ToolUse } from "../../../assistant-message"
import { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { ToolValidationUtils } from "./ToolValidationUtils"
import { ClineSay } from "@shared/ExtensionMessage"

/**
 * Simple execution strategies for different tool categories
 */
export class ToolExecutionStrategies {
	/**
	 * Execute simple tools that don't require complex approval flows
	 */
	static async executeSimpleTool(
		block: ToolUse,
		coordinator: ToolExecutorCoordinator,
		config: any,
		pushToolResult: (content: any, block: ToolUse) => void,
	): Promise<void> {
		const result = await coordinator.execute(config, block)
		pushToolResult(result, block)
	}

	/**
	 * Execute tools that require validation error checking
	 */
	static async executeToolWithValidation(
		block: ToolUse,
		coordinator: ToolExecutorCoordinator,
		config: any,
		pushToolResult: (content: any, block: ToolUse) => void,
	): Promise<void> {
		const result = await coordinator.execute(config, block)

		// Check if handler returned an error
		if (ToolValidationUtils.isValidationError(result)) {
			pushToolResult(result, block)
			return
		}

		// Push the successful result
		pushToolResult(result, block)
	}

	/**
	 * Execute tools that show a loading message first
	 */
	static async executeToolWithLoadingMessage(
		block: ToolUse,
		coordinator: ToolExecutorCoordinator,
		config: any,
		pushToolResult: (content: any, block: ToolUse) => void,
		say: (
			type: ClineSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
		) => Promise<number | undefined>,
		messageType: ClineSay = "load_mcp_documentation" as ClineSay,
	): Promise<void> {
		// Show loading message
		await say(messageType, "", undefined, undefined, false)

		const result = await coordinator.execute(config, block)

		// Check if handler returned an error
		if (ToolValidationUtils.isValidationError(result)) {
			pushToolResult(result, block)
			return
		}

		// Push the successful result
		pushToolResult(result, block)
	}
}
