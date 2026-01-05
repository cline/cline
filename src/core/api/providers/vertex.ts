import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { FunctionDeclaration as GoogleTool } from "@google/genai"
import { ModelInfo, VertexModelId, vertexDefaultModelId, vertexModels } from "@shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { sanitizeAnthropicMessages } from "../transform/anthropic-format"
import { ApiStream } from "../transform/stream"
import { GeminiHandler } from "./gemini"

interface VertexHandlerOptions extends CommonApiHandlerOptions {
	vertexProjectId?: string
	vertexRegion?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
	geminiApiKey?: string
	geminiBaseUrl?: string
	ulid?: string
	thinkingLevel?: string
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
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ClineTool[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id

		// For Gemini models, use the GeminiHandler
		if (!modelId.includes("claude")) {
			const geminiHandler = this.ensureGeminiHandler()
			yield* geminiHandler.createMessage(systemPrompt, messages, tools as GoogleTool[])
			return
		}

		const clientAnthropic = this.ensureAnthropicClient()

		// Claude implementation
		const budget_tokens = this.options.thinkingBudgetTokens || 0
		// Use model metadata to determine if reasoning should be enabled
		const reasoningOn = (model.info.supportsReasoning ?? false) && budget_tokens !== 0

		// Tools are available only when native tools are enabled.
		const nativeToolsOn = tools?.length ? tools?.length > 0 : false

		const anthropicMessages = sanitizeAnthropicMessages(messages, model.info.supportsPromptCache ?? false)

		const stream = await clientAnthropic.beta.messages.create(
			{
				model: modelId,
				max_tokens: model.info.maxTokens || 8192,
				thinking: reasoningOn ? { type: "enabled", budget_tokens: budget_tokens } : undefined,
				temperature: reasoningOn ? undefined : 0,
				system: [
					{
						text: systemPrompt,
						type: "text",
						cache_control: model.info.supportsPromptCache ? { type: "ephemeral" } : undefined,
					},
				],
				messages: anthropicMessages,
				stream: true,
				tools: nativeToolsOn ? (tools as AnthropicTool[]) : undefined,
				// tool_choice options:
				// - none: disables tool use, even if tools are provided. Claude will not call any tools.
				// - auto: allows Claude to decide whether to call any provided tools or not. This is the default value when tools are provided.
				// - any: tells Claude that it must use one of the provided tools, but doesn’t force a particular tool.
				// NOTE: Forcing tool use when tools are provided will result in error when thinking is also enabled.
				tool_choice: nativeToolsOn && !reasoningOn ? { type: "any" } : undefined,
			},
			{
				headers: {},
			},
		)

		const lastStartedToolCall = { id: "", name: "", arguments: "" }

		for await (const chunk of stream) {
			switch (chunk?.type) {
				case "message_start": {
					const usage = chunk.message.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
						cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
						cacheReadTokens: usage.cache_read_input_tokens || undefined,
					}
					break
				}
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
						case "tool_use":
							if (chunk.content_block.id && chunk.content_block.name) {
								// Convert Anthropic tool_use to OpenAI-compatible format
								lastStartedToolCall.id = chunk.content_block.id
								lastStartedToolCall.name = chunk.content_block.name
								lastStartedToolCall.arguments = ""
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
						case "signature_delta":
							yield {
								type: "reasoning",
								reasoning: "",
								signature: chunk.delta.signature,
							}
							break
						case "thinking_delta":
							yield {
								type: "reasoning",
								reasoning: chunk.delta.thinking,
							}
							break
						case "input_json_delta":
							if (lastStartedToolCall.id && lastStartedToolCall.name && chunk.delta.partial_json) {
								// 	// Convert Anthropic tool_use to OpenAI-compatible format
								yield {
									type: "tool_calls",
									tool_call: {
										...lastStartedToolCall,
										function: {
											id: lastStartedToolCall.id,
											name: lastStartedToolCall.name,
											arguments: chunk.delta.partial_json,
										},
									},
								}
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
					lastStartedToolCall.id = ""
					lastStartedToolCall.name = ""
					lastStartedToolCall.arguments = ""
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
