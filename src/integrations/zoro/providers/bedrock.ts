/**
 * Bedrock Provider Adapter
 *
 * Isolates all AWS Bedrock-specific quirks and formatting requirements:
 *
 * QUIRK #1: Thinking blocks must be kept in assistant messages (required when extended thinking enabled)
 * QUIRK #2: Messages with empty content array are rejected
 * QUIRK #3: Assistant messages must have at least one content block
 * QUIRK #4: All tool results must be in ONE user message
 * QUIRK #5: Tool result content is converted from string to array internally
 * QUIRK #6: Thinking/reasoning comes as "reasoning" in stream chunks
 * QUIRK #7: Specific validation errors are recoverable
 * QUIRK #8: When extended thinking is enabled, assistant messages MUST start with thinking block
 */

import type { ConsumedStreamResult, ConversationMessage, ProviderAdapter, StreamCallbacks, ToolCall, ToolExecution } from "./base"

export class BedrockAdapter implements ProviderAdapter {
	readonly name = "bedrock"

	/**
	 * QUIRK #1 & #2: Keep thinking in assistant messages, filter from user messages
	 * QUIRK #8: When extended thinking is enabled, assistant messages MUST start with thinking
	 * RETROFIT: Ensures ALL assistant messages have thinking first, even old messages
	 */
	prepareMessages(messages: ConversationMessage[]): any[] {
		const prepared = messages
			.map((msg) => {
				// Filter thinking from user messages only
				let content = msg.role === "user" ? msg.content.filter((block) => block.type !== "thinking") : msg.content // Keep all content for assistant messages

				// QUIRK #8 RETROFIT: Ensure assistant messages ALWAYS start with thinking
				// This fixes both new and old messages that might be missing thinking blocks
				if (msg.role === "assistant" && content.length > 0) {
					const firstBlock = content[0]
					if (firstBlock.type !== "thinking") {
						// Missing thinking block - add placeholder at the start
						console.log("[BedrockAdapter] Retrofitting thinking block for assistant message")
						content = [{ type: "thinking", thinking: "Processing request." }, ...content]
					}
				}

				return { role: msg.role, content }
			})
			// QUIRK #2: Filter out messages with no content - Bedrock rejects these
			.filter((msg) => msg.content.length > 0)

		return prepared
	}

	/**
	 * QUIRK #3 & #8: Ensure assistant message always has content
	 * QUIRK #8: When extended thinking is enabled, thinking block MUST come first
	 * When LLM doesn't provide thinking, add placeholder to satisfy Bedrock
	 */
	buildAssistantMessage(text: string, toolCalls: ToolCall[], thinking?: string, thinkingSignature?: string): any {
		const content: any[] = []

		// QUIRK #8: ALWAYS include thinking block FIRST when there's any content
		// Bedrock with extended thinking requires ALL assistant messages to start with thinking
		if (text?.trim() || toolCalls.length > 0) {
			const thinkingBlock: any = {
				type: "thinking",
				thinking: thinking?.trim() || "Processing request.",
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
				console.warn(`[BedrockAdapter] Failed to parse tool arguments for ${call.name}:`, error)
				// Skip malformed tool calls
			}
		}

		// QUIRK #3: Bedrock requires at least one content block
		// If we have no text and no tools, add a minimal text block
		if (content.length === 0) {
			console.warn("[BedrockAdapter] Empty assistant message detected, adding placeholder text")
			content.push({ type: "text", text: "." })
		}

		return {
			role: "assistant",
			content,
		}
	}

	/**
	 * QUIRK #4: All tool results in ONE user message
	 * Bedrock requires all tool results to be in a single user message
	 */
	buildToolResultMessage(toolExecutions: ToolExecution[]): any {
		return {
			role: "user",
			content: toolExecutions.map((execution) => ({
				type: "tool_result",
				tool_use_id: execution.id,
				content: execution.result, // QUIRK #5: String is OK, Bedrock converts to array internally
			})),
		}
	}

	/**
	 * QUIRK #6: Handle Bedrock's stream format
	 * - tool_calls chunks use OpenAI-compatible format
	 * - reasoning chunks use "reasoning" type (not "thinking")
	 */
	async consumeStream(stream: AsyncGenerator, callbacks: StreamCallbacks): Promise<ConsumedStreamResult> {
		const toolCallsMap = new Map<string, { name: string; args: string }>()
		let textAccumulator = ""
		let thinkingAccumulator = ""
		let thinkingSignature: string | undefined

		// Use counter for stable IDs to avoid Date.now() collisions
		let toolIdCounter = 0

		for await (const chunk of stream) {
			const typedChunk = chunk as any
			if (typedChunk.type === "text") {
				textAccumulator += typedChunk.text
				callbacks.onText(typedChunk.text)
			}

			if (typedChunk.type === "tool_calls") {
				const tc = typedChunk.tool_call
				// Generate stable IDs using counter instead of Date.now()
				const id = tc.function?.id || `tool_${++toolIdCounter}`
				const name = tc.function?.name || ""
				const args = tc.function?.arguments || ""

				if (!toolCallsMap.has(id)) {
					toolCallsMap.set(id, { name, args: "" })
				}

				const toolData = toolCallsMap.get(id)!
				toolData.args += args
			}

			// QUIRK #6: Bedrock sends thinking as "reasoning" type
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
	 * QUIRK #9: Pre-validate tool calls to prevent mismatched counts
	 * Bedrock requires tool_use count to match tool_result count exactly.
	 * Filter out tool calls with malformed JSON arguments before execution.
	 */
	validateToolCalls(toolCalls: ToolCall[]): ToolCall[] {
		return toolCalls.filter((call) => {
			try {
				JSON.parse(call.arguments)
				return true
			} catch (error) {
				console.warn(
					`[BedrockAdapter] Skipping malformed tool call: ${call.name} - ${error instanceof Error ? error.message : "Invalid JSON"}`,
				)
				return false
			}
		})
	}

	/**
	 * QUIRK #7: Bedrock validation errors are often recoverable
	 * - "content must not be empty" → Need to add placeholder text
	 * - "ValidationException" → Usually a message format issue
	 */
	isRecoverableError(error: any): boolean {
		const msg = error?.message || ""
		const name = error?.name || ""

		return msg.includes("content must not be empty") || msg.includes("ValidationException") || name === "ValidationException"
	}

	/**
	 * Transient errors that should trigger retry
	 */
	shouldRetry(error: any): boolean {
		const msg = error?.message || ""
		const name = error?.name || ""

		return (
			msg.includes("ThrottlingException") ||
			msg.includes("ServiceUnavailableException") ||
			name === "ThrottlingException" ||
			name === "ServiceUnavailableException"
		)
	}
}
