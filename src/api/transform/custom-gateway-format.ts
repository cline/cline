import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { CompatibilityMode } from "../../shared/api"
import { convertToOpenAiMessages } from "./openai-format"

// Convert Anthropic messages to OpenAI format
export function convertToOpenAiFormat(
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
	return [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
}

// Convert Anthropic messages to Anthropic format (pass-through)
export function convertToAnthropicFormat(
	_systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
	return messages
}

// Convert Anthropic messages to Bedrock format
export function convertToBedrockFormat(
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
): {
	input: {
		messages: Array<{
			role: string
			content:
				| string
				| Array<{
						type: "text" | "image"
						text?: string
						image?: { source: { type: "url"; url: string } }
				  }>
		}>
	}
} {
	return {
		input: {
			messages: [
				{ role: "system", content: systemPrompt },
				...messages.map((msg) => {
					if (typeof msg.content === "string") {
						return {
							role: msg.role,
							content: msg.content,
						}
					}

					// Handle array content with text and images
					const content = msg.content.reduce<
						Array<{
							type: "text" | "image"
							text?: string
							image?: { source: { type: "url"; url: string } }
						}>
					>((acc, part) => {
						if (part.type === "text") {
							acc.push({
								type: "text",
								text: part.text,
							})
						} else if (part.type === "image") {
							acc.push({
								type: "image",
								image: {
									source: {
										type: "url",
										url: `data:${part.source.media_type};base64,${part.source.data}`,
									},
								},
							})
						}
						// Skip tool_use and tool_result blocks as they're not supported in Bedrock
						return acc
					}, [])

					return {
						role: msg.role,
						content,
					}
				}),
			],
		},
	}
}

// Convert messages based on compatibility mode
export function convertMessages(
	mode: CompatibilityMode,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
): unknown {
	switch (mode) {
		case "openai":
			return convertToOpenAiFormat(systemPrompt, messages)
		case "anthropic":
			return convertToAnthropicFormat(systemPrompt, messages)
		case "bedrock":
			return convertToBedrockFormat(systemPrompt, messages)
		default:
			throw new Error(`Unsupported compatibility mode: ${mode}`)
	}
}

// Validate message format based on compatibility mode
export function validateMessageFormat(mode: CompatibilityMode, messages: unknown): void {
	switch (mode) {
		case "openai":
			validateOpenAiFormat(messages)
			break
		case "anthropic":
			validateAnthropicFormat(messages)
			break
		case "bedrock":
			validateBedrockFormat(messages)
			break
		default:
			throw new Error(`Unsupported compatibility mode: ${mode}`)
	}
}

function validateOpenAiFormat(messages: unknown): void {
	if (!Array.isArray(messages)) {
		throw new Error("OpenAI format requires an array of messages")
	}

	for (const msg of messages) {
		if (!msg || typeof msg !== "object") {
			throw new Error("Each message must be an object")
		}

		if (!("role" in msg) || !["system", "user", "assistant", "tool"].includes(msg.role as string)) {
			throw new Error("Invalid message role")
		}

		if (!("content" in msg)) {
			throw new Error("Message content is required")
		}

		if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (!part || typeof part !== "object") {
					throw new Error("Content array must contain objects")
				}
				if (!("type" in part) || !["text", "image_url"].includes(part.type as string)) {
					throw new Error("Invalid content type")
				}
			}
		}
	}
}

function validateAnthropicFormat(messages: unknown): void {
	if (!Array.isArray(messages)) {
		throw new Error("Anthropic format requires an array of messages")
	}

	for (const msg of messages) {
		if (!msg || typeof msg !== "object") {
			throw new Error("Each message must be an object")
		}

		if (!("role" in msg) || !["user", "assistant"].includes(msg.role as string)) {
			throw new Error("Invalid message role")
		}

		if (!("content" in msg)) {
			throw new Error("Message content is required")
		}

		if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (!part || typeof part !== "object") {
					throw new Error("Content array must contain objects")
				}
				if (!("type" in part) || !["text", "image"].includes(part.type as string)) {
					throw new Error("Invalid content type")
				}
			}
		}
	}
}

function validateBedrockFormat(messages: unknown): void {
	if (!messages || typeof messages !== "object") {
		throw new Error("Bedrock format requires an object")
	}

	if (!("input" in messages) || !messages.input || typeof messages.input !== "object") {
		throw new Error("Missing or invalid input object")
	}

	const input = messages.input as { messages?: unknown }
	if (!input.messages || !Array.isArray(input.messages)) {
		throw new Error("Input must contain an array of messages")
	}

	for (const msg of input.messages) {
		if (!msg || typeof msg !== "object") {
			throw new Error("Each message must be an object")
		}

		if (!("role" in msg) || !["system", "user", "assistant"].includes(msg.role as string)) {
			throw new Error("Invalid message role")
		}

		if (!("content" in msg)) {
			throw new Error("Message content is required")
		}

		if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (!part || typeof part !== "object") {
					throw new Error("Content array must contain objects")
				}
				if (!("type" in part) || !["text", "image"].includes(part.type as string)) {
					throw new Error("Invalid content type")
				}
			}
		}
	}
}
