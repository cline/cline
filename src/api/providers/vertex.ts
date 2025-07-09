import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "@shared/api"
import { ApiStream } from "@api/transform/stream"
import { GeminiHandler } from "./gemini"

interface VertexHandlerOptions {
	vertexProjectId?: string
	vertexRegion?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
	geminiApiKey?: string
	geminiBaseUrl?: string
	taskId?: string
}

export class VertexHandler implements ApiHandler {
	private geminiHandler: GeminiHandler | undefined
	private clientAnthropic: AnthropicVertex | undefined
	private options: VertexHandlerOptions

	constructor(options: VertexHandlerOptions) {
		this.options = options
	}

	private ensureGeminiHandler(): GeminiHandler {
		if (!this.geminiHandler) {
			try {
				// Create a GeminiHandler with isVertex flag for Gemini models
				this.geminiHandler = new GeminiHandler({
					...this.options,
					isVertex: true,
				})
			} catch (error: any) {
				throw new Error(`Error creating Vertex AI Gemini handler: ${error.message}`)
			}
		}
		return this.geminiHandler
	}

	private ensureAnthropicClient(): AnthropicVertex {
		if (!this.clientAnthropic) {
			if (!this.options.vertexProjectId) {
				throw new Error("Vertex AI project ID is required")
			}
			if (!this.options.vertexRegion) {
				throw new Error("Vertex AI region is required")
			}
			try {
				// Initialize Anthropic client for Claude models
				this.clientAnthropic = new AnthropicVertex({
					projectId: this.options.vertexProjectId,
					// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
					region: this.options.vertexRegion,
				})
			} catch (error: any) {
				throw new Error(`Error creating Vertex AI Anthropic client: ${error.message}`)
			}
		}
		return this.clientAnthropic
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id

		// For Gemini models, use the GeminiHandler
		if (!modelId.includes("claude")) {
			const geminiHandler = this.ensureGeminiHandler()
			yield* geminiHandler.createMessage(systemPrompt, messages)
			return
		}

		const clientAnthropic = this.ensureAnthropicClient()

		// Claude implementation
		let budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn =
			(modelId.includes("3-7") || modelId.includes("sonnet-4") || modelId.includes("opus-4")) && budget_tokens !== 0
				? true
				: false
		let stream

		switch (modelId) {
			case "claude-sonnet-4@20250514":
			case "claude-opus-4@20250514":
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
				stream = await clientAnthropic.beta.messages.create(
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
				stream = await clientAnthropic.beta.messages.create({
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
			switch (chunk?.type) {
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
						outputTokens: chunk.usage?.output_tokens || 0,
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
