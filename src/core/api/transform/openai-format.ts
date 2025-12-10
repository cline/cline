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
						tool_call_id: toolMessage.tool_use_id,
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
						// @ts-ignore-next-line
						if (part.type === "text" && part.reasoning_details) {
							// @ts-ignore-next-line
							if (Array.isArray(part.reasoning_details)) {
								// @ts-ignore-next-line
								reasoningDetails.push(...part.reasoning_details)
							} else {
								// @ts-ignore-next-line
								reasoningDetails.push(part.reasoning_details)
							}
							// @ts-ignore-next-line
							// delete part.reasoning_details
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
					if (toolDetails?.length) {
						if (Array.isArray(toolDetails)) {
							reasoningDetails.push(...toolDetails)
						} else {
							reasoningDetails.push(toolDetails)
						}
					}

					return {
						id: toolMessage.id,
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

				openAiMessages.push({
					role: "assistant",
					content: finalContent,
					// Cannot be an empty array. API expects an array with minimum length 1, and will respond with an error if it's empty
					tool_calls: tool_calls?.length > 0 ? tool_calls : undefined,
					// @ts-ignore-next-line
					reasoning_details: reasoningDetails.length > 0 ? consolidateReasoningDetails(reasoningDetails) : undefined,
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
							console.error("Failed to parse tool arguments:", error)
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
		console.error("Error converting OpenAI message to Anthropic format:", error)
	}

	return anthropicMessage
}
