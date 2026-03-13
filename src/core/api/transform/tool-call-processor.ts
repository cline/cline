import type {
	ChatCompletionChunk,
	ChatCompletionToolChoiceOption,
	ChatCompletionTool as OpenAITool,
} from "openai/resources/chat/completions"
import { Logger } from "@/shared/services/Logger"
import type { ApiStreamToolCallsChunk } from "./stream"

/**
 * Helper class to process tool call deltas from OpenAI-compatible streaming responses.
 * Handles accumulating tool call ID and name across multiple delta chunks,
 * and yields properly formatted tool call chunks when arguments are received.
 */
export class ToolCallProcessor {
	private toolCallStateByIndex: Map<number, { id: string; name: string }>

	constructor() {
		this.toolCallStateByIndex = new Map()
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

		for (const [fallbackIndex, toolCallDelta] of toolCallDeltas.entries()) {
			// OpenAI-style streams include an index per tool call. Use iteration order as a fallback.
			const toolCallIndex = toolCallDelta.index ?? fallbackIndex
			const toolCallState = this.getOrCreateToolCallState(toolCallIndex)

			// Accumulate the tool call ID if present
			if (toolCallDelta.id) {
				toolCallState.id = toolCallDelta.id
			}

			// Accumulate the function name if present
			if (toolCallDelta.function?.name) {
				Logger.debug(`[ToolCallProcessor] Native Tool Called: ${toolCallDelta.function.name}`)
				toolCallState.name = toolCallDelta.function.name
			}

			// Only yield when we have all required fields: id, name, and arguments
			if (toolCallState.id && toolCallState.name && toolCallDelta.function?.arguments) {
				yield {
					type: "tool_calls",
					tool_call: {
						...toolCallDelta,
						function: {
							...toolCallDelta.function,
							id: toolCallState.id,
							name: toolCallState.name,
						},
					},
				}
			}
		}
	}

	private getOrCreateToolCallState(index: number): { id: string; name: string } {
		const existingState = this.toolCallStateByIndex.get(index)
		if (existingState) {
			return existingState
		}

		const initialState = { id: "", name: "" }
		this.toolCallStateByIndex.set(index, initialState)
		return initialState
	}

	/**
	 * Reset the internal state. Call this when starting a new message.
	 */
	reset(): void {
		this.toolCallStateByIndex.clear()
	}

	/**
	 * Get the current accumulated tool call state (useful for debugging).
	 */
	getState(): Record<number, { id: string; name: string }> {
		return Object.fromEntries(this.toolCallStateByIndex.entries())
	}
}

export function getOpenAIToolParams(tools?: OpenAITool[], enableParallelToolCalls = false) {
	if (!tools?.length) {
		return {
			tools: undefined,
		}
	}

	return {
		tools,
		tool_choice: "auto" as ChatCompletionToolChoiceOption,
		parallel_tool_calls: enableParallelToolCalls,
	}
}
