import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
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

// OpenAI API has a maximum tool call ID length of 40 characters
const MAX_TOOL_CALL_ID_LENGTH = 40

/**
 * Determines if a given tool ID follows the OpenAI Responses API format for tool calls.
 * OpenAI tool call IDs start with "fc_" and are exactly 53 characters long.
 *
 * @param callId - The tool ID to check
 * @returns True if the tool ID matches the OpenAI Responses API format, false otherwise
 */
function isOpenAIResponseToolId(callId: string): boolean {
	return callId.startsWith("fc_") && callId.length === 53
}

/**
 * Transforms a tool ID to a consistent format for OpenAI's Chat Completions API.
 * This function MUST be used for both tool_calls[].id (assistant) and tool_call_id (tool result)
 * to ensure they match - otherwise OpenAI will reject the request with:
 * "Invalid parameter: 'tool_call_id' of 'xxx' not found in 'tool_calls' of previous message."
 *
 * @param toolId - The original tool ID from Cline/Anthropic format
 * @returns The transformed ID suitable for OpenAI API
 */
function transformToolCallId(toolId: string): string {
	// OpenAI Responses API uses "fc_" prefix with 53 char length
	// Convert these to "call_" prefix format for Chat Completions API
	if (isOpenAIResponseToolId(toolId)) {
		// Use the last 33 chars + "call_" (5 chars) to stay under the 40-char limit.
		return `call_${toolId.slice(toolId.length - (MAX_TOOL_CALL_ID_LENGTH - 5))}`
	}
	// Ensure ID doesn't exceed max length
	if (toolId.length > MAX_TOOL_CALL_ID_LENGTH) {
		return toolId.slice(0, MAX_TOOL_CALL_ID_LENGTH)
	}
	return toolId
}

/**
 * Converts an array of ClineStorageMessage objects to OpenAI's Completions API format.
 *
 * Handles conversion of Cline-specific content types (tool uses, tool results, images, reasoning details)
 * into OpenAI's expected message structure, including tool_calls and tool_call_id fields.
 *
 * @param anthropicMessages - Array of ClineStorageMessage objects to be converted
 * @returns Array of OpenAI.Chat.ChatCompletionMessageParam objects
 */
export function convertToOpenAiMessages(
	anthropicMessages: Omit<ClineStorageMessage, "modelInfo">[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

	for (const anthropicMessage of anthropicMessages) {
		if (typeof anthropicMessage.content === "string") {
			openAiMessages.push({
				role: anthropicMessage.role,
				content: anthropicMessage.content,
			})
		} else {
			// image_url.url is base64 encoded image data
			// ensure it contains the content-type of the image: data:image/png;base64,
			/*
        { role: "user", content: "" | { type: "text", text: string } | { type: "image_url", image_url: { url: string } } },
         // content required unless tool_calls is present
        { role: "assistant", content?: "" | null, tool_calls?: [{ id: "", function: { name: "", arguments: "" }, type: "function" }] },
        { role: "tool", tool_call_id: "", content: ""}
         */
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
						} // user cannot send tool_use messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process tool result messages FIRST since they must follow the tool use messages
				const toolResultImages: ClineImageContentBlock[] = []
				toolMessages.forEach((toolMessage) => {
					// The Anthropic SDK allows tool results to be a string or an array of text and image blocks, enabling rich and structured content. In contrast, the OpenAI SDK only supports tool results as a single string, so we map the Anthropic tool result parts into one concatenated string to maintain compatibility.
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
						// Handle undefined content
						content = ""
					}
					openAiMessages.push({
						role: "tool",
						// The tool_call_id must match the id used in the assistant's tool_calls array.
						// Use the same transformation logic as tool_calls to ensure IDs match.
						tool_call_id: transformToolCallId(toolMessage.tool_use_id),
						content: content,
					})
				})

				// If tool results contain images, send as a separate user message
				// I ran into an issue where if I gave feedback for one of many tool uses, the request would fail.
				// "Messages following `tool_use` blocks must begin with a matching number of `tool_result` blocks."
				// Therefore we need to send these images after the tool result messages
				// NOTE: it's actually okay to have multiple user messages in a row, the model will treat them as a continuation of the same input (this way works better than combining them into one message, since the tool result specifically mentions (see following user message for image)
				// UPDATE v2.0: we don't use tools anymore, but if we did it's important to note that the openrouter prompt caching mechanism requires one user message at a time, so we would need to add these images to the user content array instead.
				if (toolResultImages.length > 0) {
					openAiMessages.push({
						role: "user",
						content: toolResultImages.map((part) => ({
							type: "image_url",
							image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` },
						})),
					})
				}

				// Process non-tool messages
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
						} // assistant cannot send tool_result messages
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process non-tool messages
				let content: string | undefined
				const reasoningDetails: any[] = []
				const thinkingBlock = []
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
						if (part.type === "thinking" && part.thinking) {
							// Reasoning details should have been moved to the text block
							thinkingBlock.push(part)
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

				// Process tool use messages
				const tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolMessages.map((toolMessage) => {
					const toolDetails = toolMessage.reasoning_details
					const toolId = toolMessage.id
					if (toolDetails) {
						if (Array.isArray(toolDetails)) {
							// For Gemini: reasoning details must be linkable back to the tool call.
							// Sometimes OpenRouter/Gemini returns entries without `id`; those poison the next request.
							// Keep only entries with an id matching the tool call id.
							// See: https://github.com/cline/cline/issues/8214
							const validDetails = toolDetails.filter((detail: any) => detail?.id === toolId)
							if (validDetails.length > 0) {
								reasoningDetails.push(...validDetails)
							}
						} else {
							// Single reasoning detail - only include if it has matching id
							const detail = toolDetails as any
							if (detail?.id === toolId) {
								reasoningDetails.push(toolDetails)
							}
						}
					}

					return {
						// Use the same transformation as tool_call_id to ensure IDs match
						id: transformToolCallId(toolId),
						type: "function",
						function: {
							name: toolMessage.name,
							// json string
							arguments: JSON.stringify(toolMessage.input),
						},
					}
				})

				// Set content to blank when tool_calls are present but content has no text, per OpenAI API spec
				const hasToolCalls = tool_calls.length > 0
				const hasMeaningfulContent = content !== undefined && content.trim() !== ""
				const finalContent = hasMeaningfulContent ? content : hasToolCalls ? null : undefined

				const consolidatedReasoningDetails =
					reasoningDetails.length > 0 ? consolidateReasoningDetails(reasoningDetails as any) : []

				openAiMessages.push({
					role: "assistant",
					content: finalContent,
					// Cannot be an empty array. API expects an array with minimum length 1, and will respond with an error if it's empty
					tool_calls: tool_calls?.length > 0 ? tool_calls : undefined,
					// Only include reasoning_details when non-empty; sending [] can trigger provider validation issues.
					// @ts-expect-error
					reasoning_details: consolidatedReasoningDetails.length > 0 ? consolidatedReasoningDetails : undefined,
				})
			}
		}
	}

	return openAiMessages
}

// Type for OpenRouter's reasoning detail elements
// https://openrouter.ai/docs/use-cases/reasoning-tokens#streaming-response
type ReasoningDetail = {
	// https://openrouter.ai/docs/use-cases/reasoning-tokens#reasoning-detail-types
	type: string // "reasoning.summary" | "reasoning.encrypted" | "reasoning.text"
	text?: string
	data?: string // Encrypted reasoning data
	signature?: string | null
	id?: string | null // Unique identifier for the reasoning detail
	/*
	 The format of the reasoning detail, with possible values:
	 	"unknown" - Format is not specified
		"openai-responses-v1" - OpenAI responses format version 1
		"anthropic-claude-v1" - Anthropic Claude format version 1 (default)
	 */
	format: string //"unknown" | "openai-responses-v1" | "anthropic-claude-v1" | "xai-responses-v1"
	index?: number // Sequential index of the reasoning detail
}

// Helper function to convert reasoning_details array to the format OpenRouter API expects
// Takes an array of reasoning detail objects and consolidates them by index
function consolidateReasoningDetails(reasoningDetails: ReasoningDetail[]): ReasoningDetail[] {
	if (!reasoningDetails || reasoningDetails.length === 0) {
		return []
	}

	// Group by index
	const groupedByIndex = new Map<number, ReasoningDetail[]>()

	for (const detail of reasoningDetails) {
		// Drop corrupted encrypted reasoning blocks that would otherwise trigger:
		// "Invalid input: expected string, received undefined" for reasoning_details.*.data
		// See: https://github.com/cline/cline/issues/8214
		if (detail.type === "reasoning.encrypted" && !detail.data) continue

		const index = detail.index ?? 0
		if (!groupedByIndex.has(index)) {
			groupedByIndex.set(index, [])
		}
		groupedByIndex.get(index)!.push(detail)
	}

	// Consolidate each group
	const consolidated: ReasoningDetail[] = []

	for (const [index, details] of groupedByIndex.entries()) {
		// Concatenate all text parts
		let concatenatedText = ""
		let signature: string | undefined
		let id: string | undefined
		let format = "unknown"
		let type = "reasoning.text"

		for (const detail of details) {
			if (detail.text) {
				concatenatedText += detail.text
			}
			// Keep the signature from the last item that has one
			if (detail.signature) {
				signature = detail.signature
			}
			// Keep the id from the last item that has one
			if (detail.id) {
				id = detail.id
			}
			// Keep format and type from any item (they should all be the same)
			if (detail.format) {
				format = detail.format
			}
			if (detail.type) {
				type = detail.type
			}
		}

		// Create consolidated entry for text
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

		// For encrypted chunks (data), only keep the last one
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

// Unique name to use to filter out tool call that cannot be parsed correctly
const UNIQUE_ERROR_TOOL_NAME = "_cline_error_unknown_function_"

// Convert OpenAI response to Anthropic format
export function convertToAnthropicMessage(completion: OpenAI.Chat.Completions.ChatCompletion): Anthropic.Messages.Message {
	const openAiMessage = completion.choices[0].message
	const anthropicMessage: Anthropic.Messages.Message = {
		id: completion.id,
		type: "message",
		role: openAiMessage.role, // always "assistant"
		content: [
			{
				type: "text",
				text: openAiMessage.content || "",
				citations: null,
			},
		],
		model: completion.model,
		stop_reason: (() => {
			switch (completion.choices[0].finish_reason) {
				case "stop":
					return "end_turn"
				case "length":
					return "max_tokens"
				case "tool_calls":
					return "tool_use"
				case "content_filter": // Anthropic doesn't have an exact equivalent
				default:
					return null
			}
		})(),
		stop_sequence: null, // which custom stop_sequence was generated, if any (not applicable if you don't use stop_sequence)
		usage: {
			input_tokens: completion.usage?.prompt_tokens || 0,
			output_tokens: completion.usage?.completion_tokens || 0,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	}
	try {
		if (openAiMessage?.tool_calls?.length) {
			const functionCalls = openAiMessage.tool_calls.filter((tc: any) => tc?.type === "function" && tc.function)
			if (functionCalls.length > 0) {
				anthropicMessage.content.push(
					...functionCalls.map((toolCall: any): Anthropic.ToolUseBlock => {
						let parsedInput = {}
						try {
							parsedInput = JSON.parse(toolCall.function?.arguments || "{}")
						} catch (error) {
							Logger.error("Failed to parse tool arguments:", error)
						}
						return {
							type: "tool_use",
							id: toolCall.id,
							name: toolCall.function?.name || UNIQUE_ERROR_TOOL_NAME,
							input: parsedInput,
						}
					}),
				)
			}

			return anthropicMessage
		}
	} catch (error) {
		Logger.error("Error converting OpenAI message to Anthropic format:", error)
	}

	return anthropicMessage
}

/**
 * Sanitizes OpenAI messages for Gemini models by removing tool_calls that lack reasoning_details.
 *
 * Gemini models require thought signatures for tool calls. When switching providers mid-conversation,
 * historical tool calls may not include Gemini reasoning details, which can poison the next request.
 * This function drops tool_calls that lack reasoning_details and their paired tool messages.
 *
 * @param messages - Array of OpenAI chat completion messages
 * @param modelId - The model ID to check if sanitization is needed
 * @returns Sanitized array of messages (unchanged if not a Gemini model)
 */
export function sanitizeGeminiMessages(
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
	modelId: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	if (!modelId.includes("gemini")) {
		return messages
	}

	const droppedToolCallIds = new Set<string>()
	const sanitized: OpenAI.Chat.ChatCompletionMessageParam[] = []

	for (const msg of messages) {
		if (msg.role === "assistant") {
			const anyMsg = msg as any
			const toolCalls = anyMsg.tool_calls
			if (Array.isArray(toolCalls) && toolCalls.length > 0) {
				const reasoningDetails = anyMsg.reasoning_details
				const hasReasoningDetails = Array.isArray(reasoningDetails) && reasoningDetails.length > 0
				if (!hasReasoningDetails) {
					for (const tc of toolCalls) {
						if (tc?.id) {
							droppedToolCallIds.add(tc.id)
						}
					}
					// Keep any textual content, but drop the tool_calls themselves.
					if (anyMsg.content) {
						sanitized.push({ role: "assistant", content: anyMsg.content } as any)
					}
					continue
				}
			}
		}

		if (msg.role === "tool") {
			const anyMsg = msg as any
			if (anyMsg.tool_call_id && droppedToolCallIds.has(anyMsg.tool_call_id)) {
				continue
			}
		}

		sanitized.push(msg)
	}

	return sanitized
}
