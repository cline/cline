import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

/**
 * Converts an array of Anthropic MessageParam objects to OpenAI ResponseInput format.
 * @param messages - Array of Anthropic messages to convert.
 * @returns An array of OpenAI ResponseInput objects.
 */
export function convertToOpenAiResponseInput(messages: Anthropic.Messages.MessageParam[]): OpenAI.Responses.ResponseInput {
	const result: OpenAI.Responses.ResponseInput = []

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]

		// Simple string content → user input text
		if (typeof msg.content === "string") {
			result.push({
				type: "message",
				role: msg.role,
				content: [{ type: "input_text", text: msg.content }],
			})
			continue
		}

		if (!Array.isArray(msg.content)) {
			throw new Error(`Invalid message content: must be string or array`)
		}

		if (msg.role === "user") {
			const inputParts: OpenAI.Responses.ResponseInputContent[] = []
			const toolResultImages: Anthropic.Messages.ImageBlockParam[] = []

			for (const part of msg.content) {
				switch (part.type) {
					case "text":
						inputParts.push({ type: "input_text", text: part.text })
						break
					case "image":
						inputParts.push({
							type: "input_image",
							image_url: `data:${part.source.media_type};base64,${part.source.data}`,
							detail: "auto",
						})
						break
					case "document":
					case "thinking":
					case "redacted_thinking":
						if ("content" in part && typeof part.content === "string") {
							inputParts.push({ type: "input_text", text: part.content })
						}
						break
					case "tool_result":
						if (typeof part.content === "string") {
							inputParts.push({ type: "input_text", text: part.content })
						} else if (Array.isArray(part.content)) {
							for (const p of part.content) {
								if (p.type === "image") {
									toolResultImages.push(p)
									inputParts.push({
										type: "input_text",
										text: "(see following user message for image)",
									})
								}
								// Intentionally ignore other block types (e.g., text) within tool_result arrays
							}
						}
						break
					default:
						console.warn(`Skipping unsupported user block type: ${part.type}`)
				}
			}

			// Push tool-result images as separate user messages
			if (toolResultImages.length > 0) {
				result.push({
					type: "message",
					role: "user",
					content: toolResultImages.map((img) => ({
						type: "input_image",
						image_url: `data:${img.source.media_type};base64,${img.source.data}`,
						detail: "auto",
					})),
				})
			}

			// Push non-image user content
			if (inputParts.length > 0) {
				result.push({
					type: "message",
					role: "user",
					content: inputParts,
				})
			}
		}

		if (msg.role === "assistant") {
			const outputParts: OpenAI.Responses.ResponseOutputText[] = []

			for (const part of msg.content) {
				switch (part.type) {
					case "text":
						outputParts.push({ type: "output_text", text: part.text, annotations: [] })
						break
					case "document":
					case "thinking":
					case "redacted_thinking":
						if ("content" in part && typeof part.content === "string") {
							outputParts.push({ type: "output_text", text: part.content, annotations: [] })
						}
						break
					case "tool_use":
						// Push a proper function_call object directly
						result.push({
							type: "function_call",
							name: part.name,
							arguments: JSON.stringify(part.input), // must be JSON string
							call_id: crypto.randomUUID(),
						})
						break
					default:
						console.warn(`Skipping unsupported assistant block type: ${part.type}`)
				}
			}

			// Push assistant text blocks using existing ID
			if (outputParts.length > 0) {
				result.push({
					type: "message",
					role: "assistant",
					id: (msg as any).id as string, // this is available at runtime
					status: "completed",
					content: outputParts,
				})
			}
		}
	}

	return result
}

export function convertToOpenAiMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
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
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolResultBlockParam[]
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
				const toolResultImages: Anthropic.Messages.ImageBlockParam[] = []
				toolMessages.forEach((toolMessage) => {
					// The Anthropic SDK allows tool results to be a string or an array of text and image blocks, enabling rich and structured content. In contrast, the OpenAI SDK only supports tool results as a single string, so we map the Anthropic tool result parts into one concatenated string to maintain compatibility.
					let content: string

					if (typeof toolMessage.content === "string") {
						content = toolMessage.content
					} else {
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
				// if (toolResultImages.length > 0) {
				// 	openAiMessages.push({
				// 		role: "user",
				// 		content: toolResultImages.map((part) => ({
				// 			type: "image_url",
				// 			image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` },
				// 		})),
				// 	})
				// }

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
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
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
				if (nonToolMessages.length > 0) {
					nonToolMessages.forEach((part) => {
						// @ts-expect-error-next-line
						if (part.type === "text" && part.reasoning_details) {
							// @ts-expect-error-next-line
							reasoningDetails.push(part.reasoning_details)
						}
					})
					content = nonToolMessages
						.map((part) => {
							if (part.type === "image") {
								return "" // impossible as the assistant cannot send images
							}
							return part.text
						})
						.join("\n")
				}

				// Process tool use messages
				const tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolMessages.map((toolMessage) => ({
					id: toolMessage.id,
					type: "function",
					function: {
						name: toolMessage.name,
						// json string
						arguments: JSON.stringify(toolMessage.input),
					},
				}))

				openAiMessages.push({
					role: "assistant",
					content,
					// Cannot be an empty array. API expects an array with minimum length 1, and will respond with an error if it's empty
					tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
					// @ts-expect-error-next-line
					reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined,
				})
			}
		}
	}

	return openAiMessages
}

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

	if (openAiMessage.tool_calls && openAiMessage.tool_calls.length > 0) {
		anthropicMessage.content.push(
			...openAiMessage.tool_calls
				.filter((toolCall) => toolCall.type === "function" && "function" in toolCall)
				.map((toolCall) => {
					let parsedInput: unknown = {}
					try {
						parsedInput = JSON.parse(toolCall.function.arguments || "{}")
					} catch (error) {
						console.error("Failed to parse tool arguments:", error)
					}
					return {
						type: "tool_use",
						id: toolCall.id,
						name: toolCall.function.name,
						input: parsedInput,
					} as Anthropic.ToolUseBlockParam
				}),
		)
	}
	return anthropicMessage
}
