import OpenAI from "openai"
import { ApiProvider } from "@/shared/api"
import {
	ClineAssistantRedactedThinkingBlock,
	ClineAssistantThinkingBlock,
	ClineAssistantToolUseBlock,
	ClineImageContentBlock,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineUserToolResultContentBlock,
} from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"

// ---- copied from openai-format.ts ----

// OpenAI API has a maximum tool call ID length of 40 characters
const MAX_TOOL_CALL_ID_LENGTH = 40

function isOpenAIResponseToolId(callId: string): boolean {
	return callId.startsWith("fc_") && callId.length === 53
}

function transformToolCallIdForNativeApi(toolId: string, provider?: ApiProvider): string {
	if (isOpenAIResponseToolId(toolId)) {
		return `call_${toolId.slice(toolId.length - (MAX_TOOL_CALL_ID_LENGTH - 5))}`
	}
	if (provider !== "openai-native") {
		return toolId
	}
	if (toolId.length > MAX_TOOL_CALL_ID_LENGTH) {
		return toolId.slice(0, MAX_TOOL_CALL_ID_LENGTH)
	}
	return toolId
}

type ReasoningDetail = {
	type: string
	text?: string
	data?: string
	signature?: string | null
	id?: string | null
	format: string
	index?: number
}

function consolidateReasoningDetails(reasoningDetails: ReasoningDetail[]): ReasoningDetail[] {
	if (!reasoningDetails || reasoningDetails.length === 0) {
		return []
	}

	const groupedByIndex = new Map<number, ReasoningDetail[]>()

	for (const detail of reasoningDetails) {
		if (detail.type === "reasoning.encrypted" && !detail.data) continue

		const index = detail.index ?? 0
		if (!groupedByIndex.has(index)) {
			groupedByIndex.set(index, [])
		}
		groupedByIndex.get(index)!.push(detail)
	}

	const consolidated: ReasoningDetail[] = []

	for (const [index, details] of groupedByIndex.entries()) {
		let concatenatedText = ""
		let signature: string | undefined
		let id: string | undefined
		let format = "unknown"
		let type = "reasoning.text"

		for (const detail of details) {
			if (detail.text) {
				concatenatedText += detail.text
			}
			if (detail.signature) {
				signature = detail.signature
			}
			if (detail.id) {
				id = detail.id
			}
			if (detail.format) {
				format = detail.format
			}
			if (detail.type) {
				type = detail.type
			}
		}

		if (concatenatedText) {
			const consolidatedEntry: ReasoningDetail = {
				type: type,
				text: concatenatedText,
				signature: signature,
				id: id,
				format: format,
				index: index,
			}
			consolidated.push(consolidatedEntry)
		}

		let lastDataEntry: ReasoningDetail | undefined
		for (const detail of details) {
			if (detail.data) {
				lastDataEntry = {
					type: detail.type,
					data: detail.data,
					signature: detail.signature,
					id: detail.id,
					format: detail.format,
					index: index,
				}
			}
		}
		if (lastDataEntry) {
			consolidated.push(lastDataEntry)
		}
	}

	return consolidated
}

export function convertDeepseekToOpenAiMessages(
	anthropicMessages: Omit<ClineStorageMessage, "modelInfo">[],
	provider?: ApiProvider,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

	for (const anthropicMessage of anthropicMessages) {
		if (typeof anthropicMessage.content === "string") {
			openAiMessages.push({
				role: anthropicMessage.role,
				content: anthropicMessage.content,
			})
		} else {
			if (anthropicMessage.role === "user") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (ClineTextContentBlock | ClineImageContentBlock)[]
					toolMessages: ClineUserToolResultContentBlock[]
				}>(
					(acc, part) => {
						if (part.type === "tool_result") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				const toolResultImages: ClineImageContentBlock[] = []
				toolMessages.forEach((toolMessage) => {
					let content: string

					if (typeof toolMessage.content === "string") {
						content = toolMessage.content
					} else if (Array.isArray(toolMessage.content)) {
						content =
							toolMessage.content
								?.map((part) => {
									if (part.type === "image") {
										toolResultImages.push(part)
										return "(see following user message for image)"
									}
									return part.text
								})
								.join("\n") ?? ""
					} else {
						content = ""
					}
					openAiMessages.push({
						role: "tool",
						tool_call_id: transformToolCallIdForNativeApi(toolMessage.tool_use_id, provider),
						content: content,
					})
				})

				if (toolResultImages.length > 0) {
					openAiMessages.push({
						role: "user",
						content: toolResultImages.map((part) => ({
							type: "image_url",
							image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` },
						})),
					})
				}

				if (nonToolMessages.length > 0) {
					openAiMessages.push({
						role: "user",
						content: nonToolMessages.map((part) => {
							if (part.type === "image") {
								return {
									type: "image_url",
									image_url: {
										url: `data:${part.source.media_type};base64,${part.source.data}`,
									},
								}
							}
							return { type: "text", text: part.text }
						}),
					})
				}
			} else if (anthropicMessage.role === "assistant") {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (
						| ClineTextContentBlock
						| ClineImageContentBlock
						| ClineAssistantThinkingBlock
						| ClineAssistantRedactedThinkingBlock
					)[]
					toolMessages: ClineAssistantToolUseBlock[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				let content: string | undefined
				const reasoningDetails: any[] = []
				if (nonToolMessages.length > 0) {
					nonToolMessages.forEach((part) => {
						const anyPart = part as any
						if (part.type === "text" && anyPart.reasoning_details) {
							if (Array.isArray(anyPart.reasoning_details)) {
								reasoningDetails.push(...anyPart.reasoning_details)
							} else {
								reasoningDetails.push(anyPart.reasoning_details)
							}
						}
					})
					content = nonToolMessages
						.map((part) => {
							if (part.type === "text" && part.text) {
								return part.text
							}
							return ""
						})
						.join("\n")
				}

				const tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolMessages.map((toolMessage) => {
					const toolDetails = toolMessage.reasoning_details
					const toolId = toolMessage.id
					if (toolDetails) {
						if (Array.isArray(toolDetails)) {
							const validDetails = toolDetails.filter((detail: any) => detail?.id === toolId)
							if (validDetails.length > 0) {
								reasoningDetails.push(...validDetails)
							}
						} else {
							const detail = toolDetails as any
							if (detail?.id === toolId) {
								reasoningDetails.push(toolDetails)
							}
						}
					}

					return {
						id: transformToolCallIdForNativeApi(toolId, provider),
						type: "function",
						function: {
							name: toolMessage.name,
							arguments: JSON.stringify(toolMessage.input),
						},
					}
				})

				const hasToolCalls = tool_calls.length > 0
				const hasMeaningfulContent = content !== undefined && content.trim() !== ""
				const finalContent = hasMeaningfulContent ? content : hasToolCalls ? null : undefined

				const consolidatedReasoningDetails =
					reasoningDetails.length > 0 ? consolidateReasoningDetails(reasoningDetails as any) : []

				// skip pure-thinking messages (only reasoning_content, no text or tool_calls)
				if (finalContent === undefined && !hasToolCalls) {
					Logger.warn("skipping deepseek pure-thinking message — use convertDeepSeekMessages for thinking mode")
					continue
				}

				openAiMessages.push({
					role: "assistant",
					content: finalContent,
					tool_calls: tool_calls?.length > 0 ? tool_calls : undefined,
					// @ts-expect-error
					reasoning_details: consolidatedReasoningDetails.length > 0 ? consolidatedReasoningDetails : undefined,
				})
			}
		}
	}

	return openAiMessages
}
// ---- end -----

/**
 * DeepSeek V4/V3 model message format with reasoning_content support.
 *
 * Per DeepSeek thinking_mode API documentation:
 * - reasoning_content is a standalone field at the assistant message level
 * - In turns with tool calls: reasoning_content MUST be passed back in all subsequent requests
 * - In turns without tool calls: reasoning_content is optional and will be ignored
 */
export type DeepSeekModelMessage = OpenAI.Chat.ChatCompletionMessageParam & {
	reasoning_content: string
}

/**
 * Converts ClineStorageMessage[] (Anthropic format) to OpenAI Chat Completions format
 * with reasoning_content attached for DeepSeek V4/V3 models.
 *
 * Strategy based on DeepSeek V4 thinking_mode documentation:
 * 1. Pure thinking messages (no text, no tool_use) are skipped — their thinking text
 *    is accumulated and attached to the next valid assistant message.
 * 2. Valid assistant messages (with text or tool_use) always carry reasoning_content
 *    when they have thinking blocks or pending thinking.
 * 3. Empty reasoning_content (thinking: "") is preserved.
 *
 * @param originalMessages - ClineStorageMessage[] in Anthropic format
 * @param systemPrompt - System prompt to prepend as role: "system"
 * @returns DeepSeekModelMessage[] ready to send to DeepSeek API
 */
export function convertDeepSeekMessages(originalMessages: ClineStorageMessage[], systemPrompt: string): DeepSeekModelMessage[] {
	const result: DeepSeekModelMessage[] = [{ role: "system", content: systemPrompt } as DeepSeekModelMessage]
	let pendingThinking = ""

	for (const msg of originalMessages) {
		if (msg.role === "assistant") {
			const { thinkingText, hasText, hasToolUse } = extractAssistantBlocks(msg)
			const converted = buildAssistantMessage(msg, hasText, hasToolUse)

			if (converted) {
				// Build reasoning_content: pending + current thinking
				let reasoning = ""
				if (pendingThinking) {
					reasoning = pendingThinking
					pendingThinking = ""
				}
				if (thinkingText) {
					reasoning = reasoning ? reasoning + "\n" + thinkingText : thinkingText
				}
				if (reasoning) {
					converted.reasoning_content = reasoning
				}
				result.push(converted)
			} else {
				// Pure thinking message — accumulate for next valid assistant
				if (thinkingText) {
					pendingThinking = pendingThinking ? pendingThinking + "\n" + thinkingText : thinkingText
				}
			}
		} else if (msg.role === "user") {
			result.push(...convertUser(msg))
			// New turn clears pending thinking buffer
			pendingThinking = ""
		}
	}

	return result
}

// ---- Internal converters ----

/**
 * Extracts thinking text and checks for text/tool_use blocks in an assistant message.
 */
function extractAssistantBlocks(msg: ClineStorageMessage): {
	thinkingText: string
	hasText: boolean
	hasToolUse: boolean
} {
	let thinkingText = ""
	let hasText = false
	let hasToolUse = false

	if (Array.isArray(msg.content)) {
		for (const part of msg.content) {
			if (part.type === "thinking") {
				thinkingText += (part as ClineAssistantThinkingBlock).thinking
			} else if (part.type === "text") {
				hasText = true
			} else if (part.type === "tool_use") {
				hasToolUse = true
			}
		}
	}

	return { thinkingText, hasText, hasToolUse }
}

/**
 * Builds an OpenAI assistant message from text and tool_use blocks.
 * Returns null if the message has neither text nor tool_use (pure thinking).
 */
function buildAssistantMessage(msg: ClineStorageMessage, hasText: boolean, hasToolUse: boolean): DeepSeekModelMessage | null {
	if (!hasText && !hasToolUse) {
		return null
	}

	if (!Array.isArray(msg.content)) {
		return { role: "assistant", content: msg.content || null } as DeepSeekModelMessage
	}

	const textParts: string[] = []
	const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []

	for (const part of msg.content) {
		if (part.type === "text") {
			textParts.push((part as ClineTextContentBlock).text)
		} else if (part.type === "tool_use") {
			const toolUse = part as ClineAssistantToolUseBlock
			toolCalls.push({
				id: toolUse.id,
				type: "function",
				function: {
					name: toolUse.name,
					arguments: JSON.stringify(toolUse.input),
				},
			})
		}
		// thinking and redacted_thinking are ignored here
	}

	return {
		role: "assistant",
		content: hasText ? textParts.join("\n") : null,
		tool_calls: hasToolUse ? toolCalls : undefined,
		reasoning_content: "",
	}
}

function convertUser(msg: ClineStorageMessage): DeepSeekModelMessage[] {
	const result: DeepSeekModelMessage[] = []

	if (!Array.isArray(msg.content)) {
		result.push({ role: "user", content: msg.content } as DeepSeekModelMessage)
		return result
	}

	const toolResultBlocks: ClineUserToolResultContentBlock[] = []
	const textParts: string[] = []
	const imageBlocks: ClineImageContentBlock[] = []

	for (const part of msg.content) {
		if (part.type === "tool_result") {
			toolResultBlocks.push(part as ClineUserToolResultContentBlock)
		} else if (part.type === "text") {
			textParts.push((part as ClineTextContentBlock).text)
		} else if (part.type === "image") {
			imageBlocks.push(part as ClineImageContentBlock)
		}
	}

	// Tool results → role: "tool"
	for (const tr of toolResultBlocks) {
		let content: string
		if (typeof tr.content === "string") {
			content = tr.content
		} else if (Array.isArray(tr.content)) {
			const imageNoteParts: string[] = []
			for (const p of tr.content) {
				if (p.type === "text") {
					imageNoteParts.push(p.text)
				} else if (p.type === "image") {
					imageNoteParts.push("(see following user message for image)")
				}
			}
			content = imageNoteParts.join("\n")
		} else {
			content = ""
		}
		result.push({
			role: "tool",
			tool_call_id: tr.tool_use_id,
			content,
		} as DeepSeekModelMessage)
	}

	// Non-tool content → role: "user"
	if (textParts.length > 0 || imageBlocks.length > 0) {
		if (imageBlocks.length === 0) {
			result.push({
				role: "user",
				content: textParts.join("\n"),
			} as DeepSeekModelMessage)
		} else {
			const parts: OpenAI.Chat.ChatCompletionContentPart[] = textParts.map((t) => ({
				type: "text" as const,
				text: t,
			}))
			for (const img of imageBlocks) {
				parts.push({
					type: "image_url",
					image_url: {
						url: `data:${img.source.media_type};base64,${img.source.data}`,
					},
				})
			}
			result.push({ role: "user", content: parts } as DeepSeekModelMessage)
		}
	}

	return result
}
