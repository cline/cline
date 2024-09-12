import { Anthropic } from "@anthropic-ai/sdk"
import { Content, EnhancedGenerateContentResponse, FunctionDeclaration, Part, SchemaType } from "@google/generative-ai"

export function convertAnthropicContentToGemini(
	content:
		| string
		| Array<
				| Anthropic.Messages.TextBlockParam
				| Anthropic.Messages.ImageBlockParam
				| Anthropic.Messages.ToolUseBlockParam
				| Anthropic.Messages.ToolResultBlockParam
		  >
): Part[] {
	if (typeof content === "string") {
		return [{ text: content }]
	}
	return content.map((block) => {
		switch (block.type) {
			case "text":
				return { text: block.text }
			case "image":
				if (block.source.type !== "base64") {
					throw new Error("Unsupported image source type")
				}
				return {
					inlineData: {
						data: block.source.data,
						mimeType: block.source.media_type,
					},
				}
			case "tool_use":
				return {
					functionCall: {
						name: block.name,
						args: block.input,
					},
				} as Part
			case "tool_result":
				return {
					functionResponse: {
						name: block.tool_use_id,
						response: {
							content: block.content,
						},
					},
				}
			default:
				throw new Error(`Unsupported content block type: ${(block as any).type}`)
		}
	})
}

export function convertAnthropicMessageToGemini(message: Anthropic.Messages.MessageParam): Content {
	return {
		role: message.role === "assistant" ? "model" : message.role,
		parts: convertAnthropicContentToGemini(message.content),
	}
}

export function convertAnthropicToolToGemini(tool: Anthropic.Messages.Tool): FunctionDeclaration {
	return {
		name: tool.name,
		description: tool.description || "",
		parameters: {
			type: SchemaType.OBJECT,
			properties: Object.fromEntries(
				Object.entries(tool.input_schema.properties || {}).map(([key, value]) => [
					key,
					{
						type: (value as any).type.toUpperCase(),
						description: (value as any).description || "",
					},
				])
			),
			required: (tool.input_schema.required as string[]) || [],
		},
	}
}

export function convertGeminiResponseToAnthropic(
	response: EnhancedGenerateContentResponse
): Anthropic.Messages.Message {
	const content: Anthropic.Messages.ContentBlock[] = []

	// Add the main text response
	const text = response.text()
	if (text) {
		content.push({ type: "text", text })
	}

	// Add function calls as tool_use blocks
	const functionCalls = response.functionCalls()
	if (functionCalls) {
		functionCalls.forEach((call, index) => {
			content.push({
				type: "tool_use",
				id: `tool_${index}`,
				name: call.name,
				input: call.args,
			})
		})
	}

	// Determine stop reason
	let stop_reason: Anthropic.Messages.Message["stop_reason"] = null
	const finishReason = response.candidates?.[0]?.finishReason
	if (finishReason) {
		switch (finishReason) {
			case "STOP":
				stop_reason = "end_turn"
				break
			case "MAX_TOKENS":
				stop_reason = "max_tokens"
				break
			case "SAFETY":
			case "RECITATION":
			case "OTHER":
				stop_reason = "stop_sequence"
				break
			// Add more cases if needed
		}
	}

	return {
		id: `msg_${Date.now()}`, // Generate a unique ID
		type: "message",
		role: "assistant",
		content,
		model: "",
		stop_reason,
		stop_sequence: null, // Gemini doesn't provide this information
		usage: {
			input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
			output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
		},
	}
}
