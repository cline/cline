import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "@shared/api"
import { ApiStream } from "@api/transform/stream"
import { VertexAI } from "@google-cloud/vertexai"
import { calculateApiCostOpenAI } from "@utils/cost"
import type { Content } from "@google-cloud/vertexai"
import { convertAnthropicMessageToVertexContent } from "../transform/gemini-format"

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private clientAnthropic: AnthropicVertex
	private clientVertex: VertexAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.clientAnthropic = new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			region: this.options.vertexRegion,
		})
		this.clientVertex = new VertexAI({
			project: this.options.vertexProjectId,
			location: this.options.vertexRegion,
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id

		if (modelId.includes("claude")) {
			let budget_tokens = this.options.thinkingBudgetTokens || 0
			const reasoningOn = modelId.includes("3-7") && budget_tokens !== 0

			let stream
			switch (modelId) {
				case "claude-3-7-sonnet@20250219":
				case "claude-3-5-sonnet-v2@20241022":
				case "claude-3-5-sonnet@20240620":
				case "claude-3-5-haiku@20241022":
				case "claude-3-opus@20240229":
				case "claude-3-haiku@20240307": {
					const userMsgIndices = messages.reduce(
						(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
						[] as number[],
					)
					const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
					const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

					stream = await this.clientAnthropic.beta.messages.create({
						model: modelId,
						max_tokens: model.info.maxTokens || 8192,
						thinking: reasoningOn ? { type: "enabled", budget_tokens } : undefined,
						temperature: reasoningOn ? undefined : 0,
						system: [{ text: systemPrompt, type: "text", cache_control: { type: "ephemeral" } }],
						messages: messages.map((message, index) => {
							if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
								return {
									...message,
									content:
										typeof message.content === "string"
											? [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }]
											: message.content.map((content, i) =>
													i === message.content.length - 1
														? { ...content, cache_control: { type: "ephemeral" } }
														: content,
												),
								}
							}
							return {
								...message,
								content:
									typeof message.content === "string"
										? [{ type: "text", text: message.content }]
										: message.content,
							}
						}),
						stream: true,
					})
					break
				}
				default: {
					stream = await this.clientAnthropic.beta.messages.create({
						model: modelId,
						max_tokens: model.info.maxTokens || 8192,
						temperature: 0,
						system: [{ text: systemPrompt, type: "text" }],
						messages: messages.map((message) => ({
							...message,
							content:
								typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content,
						})),
						stream: true,
					})
					break
				}
			}

			for await (const chunk of stream) {
				switch (chunk.type) {
					case "message_start":
						const usage = chunk.message.usage
						yield {
							type: "usage",
							inputTokens: usage.input_tokens || 0,
							outputTokens: usage.output_tokens || 0,
							cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
							cacheReadTokens: usage.cache_read_input_tokens || undefined,
						}
						break
					case "message_delta":
						yield {
							type: "usage",
							inputTokens: 0,
							outputTokens: chunk.usage.output_tokens || 0,
						}
						break
					case "content_block_start":
						if (chunk.content_block.type === "thinking") {
							yield {
								type: "reasoning",
								reasoning: chunk.content_block.thinking || "",
							}
						} else if (chunk.content_block.type === "redacted_thinking") {
							yield {
								type: "reasoning",
								reasoning: "[Redacted thinking block]",
							}
						} else if (chunk.content_block.type === "text") {
							if (chunk.index > 0) {
								yield { type: "text", text: "\n" }
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
						}
						break
					case "content_block_delta":
						if (chunk.delta.type === "thinking_delta") {
							yield {
								type: "reasoning",
								reasoning: chunk.delta.thinking,
							}
						} else if (chunk.delta.type === "text_delta") {
							yield {
								type: "text",
								text: chunk.delta.text,
							}
						}
						break
				}
			}
		} else {
			const generativeModel = this.clientVertex.getGenerativeModel({
				model: modelId,
				systemInstruction: {
					role: "system",
					parts: [{ text: systemPrompt }],
				},
			})

			// Use the correctly renamed Vertex-specific function
			const contents: Content[] = messages.map(convertAnthropicMessageToVertexContent)
			const request = { contents }

			const streamingResult = await generativeModel.generateContentStream(request)

			for await (const chunk of streamingResult.stream) {
				const candidates = chunk.candidates || []
				for (const candidate of candidates) {
					for (const part of candidate.content?.parts || []) {
						if (part.text) {
							yield {
								type: "text",
								text: part.text,
							}
						}
					}
				}
			}

			const { usageMetadata } = await streamingResult.response
			if (usageMetadata) {
				const { promptTokenCount = 0, candidatesTokenCount = 0 } = usageMetadata
				yield {
					type: "usage",
					inputTokens: promptTokenCount,
					outputTokens: candidatesTokenCount,
					totalCost: calculateApiCostOpenAI(model.info, promptTokenCount, candidatesTokenCount, 0, 0),
				}
			}
		}
	}

	getModel(): { id: VertexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId
			return { id, info: vertexModels[id] }
		}
		return {
			id: vertexDefaultModelId,
			info: vertexModels[vertexDefaultModelId],
		}
	}
}
