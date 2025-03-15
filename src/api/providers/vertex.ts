import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { VertexAI } from "@google-cloud/vertexai"

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private clientAnthropic: AnthropicVertex
	private clientVertex: VertexAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.clientAnthropic = new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
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
			const reasoningOn = modelId.includes("3-7") && budget_tokens !== 0 ? true : false

			let stream
			switch (modelId) {
				case "claude-3-7-sonnet@20250219":
				case "claude-3-5-sonnet-v2@20241022":
				case "claude-3-5-sonnet@20240620":
				case "claude-3-5-haiku@20241022":
				case "claude-3-opus@20240229":
				case "claude-3-haiku@20240307": {
					// Find indices of user messages for cache control
					const userMsgIndices = messages.reduce(
						(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
						[] as number[],
					)
					const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
					const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

					stream = await this.clientAnthropic.beta.messages.create(
						{
							model: modelId,
							max_tokens: model.info.maxTokens || 8192,
							thinking: reasoningOn ? { type: "enabled", budget_tokens: budget_tokens } : undefined,
							temperature: reasoningOn ? undefined : 0,
							system: [
								{
									text: systemPrompt,
									type: "text",
									cache_control: { type: "ephemeral" },
								},
							],
							messages: messages.map((message, index) => {
								if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
									return {
										...message,
										content:
											typeof message.content === "string"
												? [
														{
															type: "text",
															text: message.content,
															cache_control: {
																type: "ephemeral",
															},
														},
													]
												: message.content.map((content, contentIndex) =>
														contentIndex === message.content.length - 1
															? {
																	...content,
																	cache_control: {
																		type: "ephemeral",
																	},
																}
															: content,
													),
									}
								}
								return {
									...message,
									content:
										typeof message.content === "string"
											? [
													{
														type: "text",
														text: message.content,
													},
												]
											: message.content,
								}
							}),
							stream: true,
						},
						{
							headers: {},
						},
					)
					break
				}
				default: {
					stream = await this.clientAnthropic.beta.messages.create({
						model: modelId,
						max_tokens: model.info.maxTokens || 8192,
						temperature: 0,
						system: [
							{
								text: systemPrompt,
								type: "text",
							},
						],
						messages: messages.map((message) => ({
							...message,
							content:
								typeof message.content === "string"
									? [
											{
												type: "text",
												text: message.content,
											},
										]
									: message.content,
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
					case "message_stop":
						break
					case "content_block_start":
						switch (chunk.content_block.type) {
							case "thinking":
								yield {
									type: "reasoning",
									reasoning: chunk.content_block.thinking || "",
								}
								break
							case "redacted_thinking":
								// Handle redacted thinking blocks - we still mark it as reasoning
								// but note that the content is encrypted
								yield {
									type: "reasoning",
									reasoning: "[Redacted thinking block]",
								}
								break

							case "text":
								if (chunk.index > 0) {
									yield {
										type: "text",
										text: "\n",
									}
								}
								yield {
									type: "text",
									text: chunk.content_block.text,
								}
								break
						}
						break
					case "content_block_delta":
						switch (chunk.delta.type) {
							case "thinking_delta":
								yield {
									type: "reasoning",
									reasoning: chunk.delta.thinking,
								}
								break
							case "text_delta":
								yield {
									type: "text",
									text: chunk.delta.text,
								}
								break
						}
						break
					case "content_block_stop":
						break
				}
			}
		} else {
			// gemini
			const generativeModel = this.clientVertex.getGenerativeModel({
				model: this.getModel().id,
				systemInstruction: {
					role: "system",
					parts: [{ text: systemPrompt }],
				},
			})
			const request = {
				contents: [
					{
						role: "user",
						parts: messages.map((m) => {
							if (typeof m.content === "string") {
								return { text: m.content }
							} else if (Array.isArray(m.content)) {
								return {
									text: m.content
										.map((block) => {
											if (typeof block === "string") {
												return block
											} else if (block.type === "text") {
												return block.text
											} else {
												console.log("Unsupported block type", block)
												return ""
											}
										})
										.join(" "),
								}
							} else {
								return { text: "" }
							}
						}),
					},
				],
			}
			const streamingResult = await generativeModel.generateContentStream(request)
			for await (const chunk of streamingResult.stream) {
				// If usage data is available, yield it similarly:
				// yield { type: "usage", inputTokens: 0, outputTokens: 0 }
				// Otherwise, just yield text:
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
