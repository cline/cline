/**
 * Anthropic Provider Adapter
 *
 * Handles Anthropic-specific formatting (which is mostly straightforward).
 * Unlike Bedrock, Anthropic supports thinking blocks in conversation history.
 */

import type { ConsumedStreamResult, ConversationMessage, ProviderAdapter, StreamCallbacks, ToolCall, ToolExecution } from "./base"

export class AnthropicAdapter implements ProviderAdapter {
	readonly name = "anthropic"

	/**
	 * Anthropic: Keep thinking blocks (they work fine)
	 * No need to filter - Anthropic handles all content types
	 */
	prepareMessages(messages: ConversationMessage[]): any[] {
		return messages.map((msg) => ({
			role: msg.role,
			content: msg.content, // Keep all content including thinking
		}))
	}

	/**
	 * Anthropic: Include thinking block if present
	 * Thinking blocks are supported and useful for model reasoning
	 */
	buildAssistantMessage(text: string, toolCalls: ToolCall[], thinking?: string, thinkingSignature?: string): any {
		const content: any[] = []

		// Include thinking block for Anthropic (unlike Bedrock)
		if (thinking && thinking.trim()) {
			const thinkingBlock: any = {
				type: "thinking",
				thinking: thinking.trim(),
			}
			if (thinkingSignature) {
				thinkingBlock.signature = thinkingSignature
			}
			content.push(thinkingBlock)
		}

		// Add text content if present
		if (text && text.trim()) {
			content.push({ type: "text", text: text.trim() })
		}

		// Add tool_use blocks
		for (const call of toolCalls) {
			try {
				const parsedInput = JSON.parse(call.arguments)
				content.push({
					type: "tool_use",
					id: call.id,
					name: call.name,
					input: parsedInput,
				})
			} catch (error) {
				console.warn(`[AnthropicAdapter] Failed to parse tool arguments for ${call.name}:`, error)
				// Skip malformed tool calls
			}
		}

		// Anthropic is fine with empty messages (though this shouldn't happen)
		return {
			role: "assistant",
			content,
		}
	}

	/**
	 * Anthropic: Tool results in single user message
	 * (Could also use multiple messages, but single is consistent with Bedrock)
	 */
	buildToolResultMessage(toolExecutions: ToolExecution[]): any {
		return {
			role: "user",
			content: toolExecutions.map((execution) => ({
				type: "tool_result",
				tool_use_id: execution.id,
				content: execution.result,
			})),
		}
	}

	/**
	 * Stream consumption using same format as Bedrock
	 * Cline's API normalizes both providers to a common format
	 */
	async consumeStream(stream: AsyncGenerator, callbacks: StreamCallbacks): Promise<ConsumedStreamResult> {
		const toolCallsMap = new Map<string, { name: string; args: string }>()
		let textAccumulator = ""
		let thinkingAccumulator = ""
		let thinkingSignature: string | undefined

		// Use counter for stable IDs
		let toolIdCounter = 0

		for await (const chunk of stream) {
			const typedChunk = chunk as any
			if (typedChunk.type === "text") {
				textAccumulator += typedChunk.text
				callbacks.onText(typedChunk.text)
			}

			if (typedChunk.type === "tool_calls") {
				const tc = typedChunk.tool_call
				const id = tc.function?.id || `tool_${++toolIdCounter}`
				const name = tc.function?.name || ""
				const args = tc.function?.arguments || ""

				if (!toolCallsMap.has(id)) {
					toolCallsMap.set(id, { name, args: "" })
				}

				const toolData = toolCallsMap.get(id)!
				toolData.args += args
			}

			// Anthropic also sends thinking as "reasoning" through Cline's API
			if (typedChunk.type === "reasoning") {
				const reasoningText = typedChunk.reasoning || ""
				thinkingAccumulator += reasoningText
				if (typedChunk.signature) {
					thinkingSignature = typedChunk.signature
				}
				callbacks.onThinking(reasoningText, typedChunk.signature)
			}
		}

		// Emit complete tool calls
		const toolCalls: ToolCall[] = []
		for (const [id, data] of toolCallsMap) {
			callbacks.onToolCall(id, data.name, data.args)
			toolCalls.push({
				id,
				name: data.name,
				arguments: data.args,
			})
		}

		callbacks.onComplete()

		return {
			text: textAccumulator,
			toolCalls,
			thinking: thinkingAccumulator,
			thinkingSignature,
		}
	}

	/**
	 * Anthropic errors are usually not recoverable mid-stream
	 */
	isRecoverableError(error: any): boolean {
		return false
	}

	/**
	 * Retry on transient errors
	 */
	shouldRetry(error: any): boolean {
		const msg = error?.message || ""
		return msg.includes("overloaded") || msg.includes("rate_limit")
	}
}
