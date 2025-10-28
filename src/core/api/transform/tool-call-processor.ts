import type {
	ChatCompletionChunk,
	ChatCompletionToolChoiceOption,
	ChatCompletionTool as OpenAITool,
} from "openai/resources/chat/completions"
import { Logger } from "@/services/logging/Logger"
import type { ApiStreamToolCallsChunk } from "./stream"

/**
 * Helper class to process tool call deltas from OpenAI-compatible streaming responses.
 * Handles accumulating tool call ID and name across multiple delta chunks,
 * and yields properly formatted tool call chunks when arguments are received.
 */
export class ToolCallProcessor {
	private lastToolCall: { id: string; name: string }

	constructor() {
		this.lastToolCall = { id: "", name: "" }
	}

	/**
	 * Process tool call deltas from a chunk and yield formatted tool call chunks.
	 * @param toolCallDeltas - Array of tool call deltas from the chunk
	 * @yields Formatted tool call chunks ready to be yielded in the API stream
	 */
	*processToolCallDeltas(
		toolCallDeltas: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
	): Generator<ApiStreamToolCallsChunk> {
		if (!toolCallDeltas) {
			return
		}

		for (const toolCallDelta of toolCallDeltas) {
			// Accumulate the tool call ID if present
			if (toolCallDelta.id) {
				this.lastToolCall.id = toolCallDelta.id
			}

			// Accumulate the function name if present
			if (toolCallDelta.function?.name) {
				Logger.debug(`[ToolCallProcessor] Native Tool Called: ${toolCallDelta.function.name}`)
				this.lastToolCall.name = toolCallDelta.function.name
			}

			// Only yield when we have all required fields: id, name, and arguments
			if (this.lastToolCall.id && this.lastToolCall.name && toolCallDelta.function?.arguments) {
				yield {
					type: "tool_calls",
					tool_call: {
						...toolCallDelta,
						function: {
							...toolCallDelta.function,
							id: this.lastToolCall.id,
							name: this.lastToolCall.name,
						},
					},
				}
			}
		}
	}

	/**
	 * Reset the internal state. Call this when starting a new message.
	 */
	reset(): void {
		this.lastToolCall = { id: "", name: "" }
	}

	/**
	 * Get the current accumulated tool call state (useful for debugging).
	 */
	getState(): { id: string; name: string } {
		return { ...this.lastToolCall }
	}
}

export function getOpenAIToolParams(tools?: OpenAITool[]) {
	return tools?.length
		? {
				tools,
				tool_choice: tools ? ("auto" as ChatCompletionToolChoiceOption) : undefined,
				parallel_tool_calls: tools ? true : undefined,
			}
		: {
				tools: undefined,
			}
}
