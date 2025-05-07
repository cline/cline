import { ToolUse } from "../shared/tools"
import { t } from "../i18n"

/**
 * Class for detecting consecutive identical tool calls
 * to prevent the AI from getting stuck in a loop.
 */
export class ToolRepetitionDetector {
	private previousToolCallJson: string | null = null
	private consecutiveIdenticalToolCallCount: number = 0
	private readonly consecutiveIdenticalToolCallLimit: number

	/**
	 * Creates a new ToolRepetitionDetector
	 * @param limit The maximum number of identical consecutive tool calls allowed
	 */
	constructor(limit: number = 3) {
		this.consecutiveIdenticalToolCallLimit = limit
	}

	/**
	 * Checks if the current tool call is identical to the previous one
	 * and determines if execution should be allowed
	 *
	 * @param currentToolCallBlock ToolUse object representing the current tool call
	 * @returns Object indicating if execution is allowed and a message to show if not
	 */
	public check(currentToolCallBlock: ToolUse): {
		allowExecution: boolean
		askUser?: {
			messageKey: string
			messageDetail: string
		}
	} {
		// Serialize the block to a canonical JSON string for comparison
		const currentToolCallJson = this.serializeToolUse(currentToolCallBlock)

		// Compare with previous tool call
		if (this.previousToolCallJson === currentToolCallJson) {
			this.consecutiveIdenticalToolCallCount++
		} else {
			this.consecutiveIdenticalToolCallCount = 1 // Start with 1 for the first occurrence
			this.previousToolCallJson = currentToolCallJson
		}

		// Check if limit is reached
		if (this.consecutiveIdenticalToolCallCount >= this.consecutiveIdenticalToolCallLimit) {
			// Reset counters to allow recovery if user guides the AI past this point
			this.consecutiveIdenticalToolCallCount = 0
			this.previousToolCallJson = null

			// Return result indicating execution should not be allowed
			return {
				allowExecution: false,
				askUser: {
					messageKey: "mistake_limit_reached",
					messageDetail: t("tools:toolRepetitionLimitReached", { toolName: currentToolCallBlock.name }),
				},
			}
		}

		// Execution is allowed
		return { allowExecution: true }
	}

	/**
	 * Serializes a ToolUse object into a canonical JSON string for comparison
	 *
	 * @param toolUse The ToolUse object to serialize
	 * @returns JSON string representation of the tool use with sorted parameter keys
	 */
	private serializeToolUse(toolUse: ToolUse): string {
		// Create a new parameters object with alphabetically sorted keys
		const sortedParams: Record<string, unknown> = {}

		// Get parameter keys and sort them alphabetically
		const sortedKeys = Object.keys(toolUse.params).sort()

		// Populate the sorted parameters object in a type-safe way
		for (const key of sortedKeys) {
			if (Object.prototype.hasOwnProperty.call(toolUse.params, key)) {
				sortedParams[key] = toolUse.params[key as keyof typeof toolUse.params]
			}
		}

		// Create the object with the tool name and sorted parameters
		const toolObject = {
			name: toolUse.name,
			parameters: sortedParams,
		}

		// Convert to a canonical JSON string
		return JSON.stringify(toolObject)
	}
}
