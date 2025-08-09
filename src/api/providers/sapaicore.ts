import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ModelInfo, sapAiCoreDefaultModelId, SapAiCoreModelId, sapAiCoreModels } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import {
	type Message as BedrockMessage,
	type ContentBlock as BedrockContentBlock,
	ConversationRole as BedrockConversationRole,
} from "@aws-sdk/client-bedrock-runtime"

interface SapAiCoreHandlerOptions {
	sapAiCoreClientId?: string
	sapAiCoreClientSecret?: string
	sapAiCoreTokenUrl?: string
	sapAiResourceGroup?: string
	sapAiCoreBaseUrl?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
}

interface Deployment {
	id: string
	name: string
}
interface Token {
	access_token: string
	expires_in: number
	scope: string
	jti: string
	token_type: string
	expires_at: number
}

// Bedrock namespace containing caching-related functions
namespace Bedrock {
	// Define cache point type for AWS Bedrock
	interface CachePointContentBlock {
		cachePoint: {
			type: "default"
		}
	}

	// Define types for supported content types
	type SupportedContentType = "text" | "image" | "thinking"

	interface ContentItem {
		type: SupportedContentType
		text?: string
		source?: {
			data: string | Buffer | Uint8Array
			media_type?: string
		}
	}

	/**
	 * Prepares system messages with optional caching support
	 */
	export function prepareSystemMessages(systemPrompt: string, enableCaching: boolean): any[] | undefined {
		if (!systemPrompt) {
			return undefined
		}

		if (enableCaching) {
			return [{ text: systemPrompt }, { cachePoint: { type: "default" } }]
		}

		return [{ text: systemPrompt }]
	}

	/**
	 * Applies cache control to messages for prompt caching using AWS Bedrock's cachePoint system
	 * AWS Bedrock uses cachePoint objects instead of Anthropic's cache_control approach
	 */
	export function applyCacheControlToMessages(
		messages: BedrockMessage[],
		lastUserMsgIndex: number,
		secondLastMsgUserIndex: number,
	): BedrockMessage[] {
		return messages.map((message, index) => {
			// Add cachePoint to the last user message and second-to-last user message
			if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
				// Clone the message to avoid modifying the original
				const messageWithCache = { ...message }

				if (messageWithCache.content && Array.isArray(messageWithCache.content)) {
					// Add cachePoint to the end of the content array
					messageWithCache.content = [
						...messageWithCache.content,
						{
							cachePoint: {
								type: "default",
							},
						} as CachePointContentBlock, // Properly typed cache point for AWS SDK
					]
				}

				return messageWithCache
			}

			return message
		})
	}

	/**
	 * Formats messages for models using the Converse API specification
	 * Used by both Anthropic and Nova models to avoid code duplication
	 */
	export function formatMessagesForConverseAPI(messages: Anthropic.Messages.MessageParam[]): BedrockMessage[] {
		return messages.map((message) => {
			// Determine role (user or assistant)
			const role = message.role === "user" ? BedrockConversationRole.USER : BedrockConversationRole.ASSISTANT

			// Process content based on type
			let content: BedrockContentBlock[] = []

			if (typeof message.content === "string") {
				// Simple text content
				content = [{ text: message.content }]
			} else if (Array.isArray(message.content)) {
				// Convert Anthropic content format to Converse API content format
				const processedContent = message.content
					.map((item) => {
						// Text content
						if (item.type === "text") {
							return { text: item.text }
						}

						// Image content
						if (item.type === "image") {
							return processImageContent(item)
						}

						// Log unsupported content types for debugging
						console.warn(`Unsupported content type: ${(item as ContentItem).type}`)
						return null
					})
					.filter((item): item is BedrockContentBlock => item !== null)

				content = processedContent
			}

			// Return formatted message
			return {
				role,
				content,
			}
		})
	}

	/**
	 * Processes image content with proper error handling and user notification
	 */
	function processImageContent(item: any): BedrockContentBlock | null {
		let imageData: Uint8Array
		let format: "png" | "jpeg" | "gif" | "webp" = "jpeg" // default format

		// Extract format from media_type if available
		if (item.source.media_type) {
			// Extract format from media_type (e.g., "image/jpeg" -> "jpeg")
			const formatMatch = item.source.media_type.match(/image\/(\w+)/)
			if (formatMatch && formatMatch[1]) {
				const extractedFormat = formatMatch[1]
				// Ensure format is one of the allowed values
				if (["png", "jpeg", "gif", "webp"].includes(extractedFormat)) {
					format = extractedFormat as "png" | "jpeg" | "gif" | "webp"
				}
			}
		}

		// Get image data with improved error handling
		try {
			if (typeof item.source.data === "string") {
				// Handle base64 encoded data
				const base64Data = item.source.data.replace(/^data:image\/\w+;base64,/, "")
				imageData = new Uint8Array(Buffer.from(base64Data, "base64"))
			} else if (item.source.data && typeof item.source.data === "object") {
				// Try to convert to Uint8Array
				imageData = new Uint8Array(Buffer.from(item.source.data as Buffer | Uint8Array))
			} else {
				throw new Error("Unsupported image data format")
			}

			return {
				image: {
					format,
					source: {
						bytes: imageData,
					},
				},
			}
		} catch (error) {
			console.error("Failed to process image content:", error)
			// Return a text content indicating the error instead of null
			// This ensures users are aware of the issue
			return {
				text: `[ERROR: Failed to process image - ${error instanceof Error ? error.message : "Unknown error"}]`,
			}
		}
	}
}

// Gemini namespace containing caching-related functions and types
namespace Gemini {
	/**
	 * Process Gemini streaming response with enhanced thinking content support and caching awareness
	 */
	export function processStreamChunk(data: any): {
		text?: string
		reasoning?: string
		usageMetadata?: {
			promptTokenCount?: number
			candidatesTokenCount?: number
			thoughtsTokenCount?: number
			cachedContentTokenCount?: number
		}
	} {
		const result: ReturnType<typeof processStreamChunk> = {}

		// Handle thinking content from Gemini's response
		const candidateForThoughts = data?.candidates?.[0]
		const partsForThoughts = candidateForThoughts?.content?.parts
		let thoughts = ""

		if (partsForThoughts) {
			for (const part of partsForThoughts) {
				const { thought, text } = part
				if (thought && text) {
					thoughts += text + "\n"
				}
			}
		}

		if (thoughts.trim() !== "") {
			result.reasoning = thoughts.trim()
		}

		// Handle regular text content
		if (data.text) {
			result.text = data.text
		}

		// Handle content parts for non-thought text
		if (data.candidates && data.candidates[0]?.content?.parts) {
			let nonThoughtText = ""
			for (const part of data.candidates[0].content.parts) {
				if (part.text && !part.thought) {
					nonThoughtText += part.text
				}
			}
			if (nonThoughtText && !result.text) {
				result.text = nonThoughtText
			}
		}

		// Handle usage metadata with caching support
		if (data.usageMetadata) {
			result.usageMetadata = {
				promptTokenCount: data.usageMetadata.promptTokenCount,
				candidatesTokenCount: data.usageMetadata.candidatesTokenCount,
				thoughtsTokenCount: data.usageMetadata.thoughtsTokenCount,
				cachedContentTokenCount: data.usageMetadata.cachedContentTokenCount,
			}
		}

		return result
	}

	function convertAnthropicMessageToGemini(message: Anthropic.Messages.MessageParam) {
		const role = message.role === "assistant" ? "model" : "user"
		const parts = []

		if (typeof message.content === "string") {
			parts.push({ text: message.content })
		} else if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === "text") {
					parts.push({ text: block.text })
				} else if (block.type === "image") {
					parts.push({
						inlineData: {
							mimeType: block.source.media_type,
							data: block.source.data,
						},
					})
				}
			}
		}

		return { role, parts }
	}

	/**
	 * Prepare Gemini request payload with thinking configuration and implicit caching support
	 */
	export function prepareRequestPayload(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		model: { id: SapAiCoreModelId; info: ModelInfo },
		thinkingBudgetTokens?: number,
	): any {
		const contents = messages.map(convertAnthropicMessageToGemini)

		const payload = {
			contents,
			systemInstruction: {
				parts: [
					{
						text: systemPrompt,
					},
				],
			},
			generationConfig: {
				maxOutputTokens: model.info.maxTokens,
				temperature: 0.0,
			},
		}

		// Add thinking config if the model supports it and budget is provided
		const thinkingBudget = thinkingBudgetTokens ?? 0
		const maxBudget = model.info.thinkingConfig?.maxBudget ?? 0

		if (thinkingBudget > 0 && model.info.thinkingConfig) {
			// Add thinking configuration to the payload
			;(payload as any).thinkingConfig = {
				thinkingBudget: thinkingBudget,
				includeThoughts: true,
			}
		}

		return payload
	}
}

export class SapAiCoreHandler implements ApiHandler {
	private options: SapAiCoreHandlerOptions
	private token?: Token
	private deployments?: Deployment[]

	constructor(options: SapAiCoreHandlerOptions) {
		this.options = options
	}

	private async authenticate(): Promise<Token> {
		const payload = {
			grant_type: "client_credentials",
			client_id: this.options.sapAiCoreClientId || "",
			client_secret: this.options.sapAiCoreClientSecret || "",
		}

		const tokenUrl = (this.options.sapAiCoreTokenUrl || "").replace(/\/+$/, "") + "/oauth/token"
		const response = await axios.post(tokenUrl, payload, {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		})
		const token = response.data as Token
		token.expires_at = Date.now() + token.expires_in * 1000
		return token
	}

	private async getToken(): Promise<string> {
		if (!this.token || this.token.expires_at < Date.now()) {
			this.token = await this.authenticate()
		}
		return this.token.access_token
	}

	private async getAiCoreDeployments(): Promise<Deployment[]> {
		if (this.options.sapAiCoreClientSecret === "") {
			return [{ id: "notconfigured", name: "ai-core-not-configured" }]
		}

		const token = await this.getToken()
		const headers = {
			Authorization: `Bearer ${token}`,
			"AI-Resource-Group": this.options.sapAiResourceGroup || "default",
			"Content-Type": "application/json",
			"AI-Client-Type": "Cline",
		}

		const url = `${this.options.sapAiCoreBaseUrl}/v2/lm/deployments?$top=10000&$skip=0`

		try {
			const response = await axios.get(url, { headers })
			const deployments = response.data.resources

			return deployments
				.filter((deployment: any) => deployment.targetStatus === "RUNNING")
				.map((deployment: any) => {
					const model = deployment.details?.resources?.backend_details?.model
					if (!model?.name || !model?.version) {
						return null // Skip this row
					}
					return {
						id: deployment.id,
						name: `${model.name}:${model.version}`,
					}
				})
				.filter((deployment: any) => deployment !== null)
		} catch (error) {
			console.error("Error fetching deployments:", error)
			throw new Error("Failed to fetch deployments")
		}
	}

	private async getDeploymentForModel(modelId: string): Promise<string> {
		// If deployments are not fetched yet or the model is not found in the fetched deployments, fetch deployments
		if (!this.deployments || !this.hasDeploymentForModel(modelId)) {
			this.deployments = await this.getAiCoreDeployments()
		}

		const deployment = this.deployments.find((d) => {
			const deploymentBaseName = d.name.split(":")[0].toLowerCase()
			const modelBaseName = modelId.split(":")[0].toLowerCase()
			return deploymentBaseName === modelBaseName
		})

		if (!deployment) {
			throw new Error(`No running deployment found for model ${modelId}`)
		}

		return deployment.id
	}

	private hasDeploymentForModel(modelId: string): boolean {
		return this.deployments?.some((d) => d.name.split(":")[0].toLowerCase() === modelId.split(":")[0].toLowerCase()) ?? false
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const token = await this.getToken()
		const headers = {
			Authorization: `Bearer ${token}`,
			"AI-Resource-Group": this.options.sapAiResourceGroup || "default",
			"Content-Type": "application/json",
			"AI-Client-Type": "Cline",
		}

		const model = this.getModel()
		const deploymentId = await this.getDeploymentForModel(model.id)

		const anthropicModels = [
			"anthropic--claude-4-sonnet",
			"anthropic--claude-4-opus",
			"anthropic--claude-3.7-sonnet",
			"anthropic--claude-3.5-sonnet",
			"anthropic--claude-3-sonnet",
			"anthropic--claude-3-haiku",
			"anthropic--claude-3-opus",
		]

		const openAIModels = [
			"gpt-4o",
			"gpt-4",
			"gpt-4o-mini",
			"o1",
			"gpt-4.1",
			"gpt-4.1-nano",
			"gpt-5",
			"gpt-5-nano",
			"gpt-5-mini",
			"o3-mini",
			"o3",
			"o4-mini",
		]

		const geminiModels = ["gemini-2.5-flash", "gemini-2.5-pro"]

		let url: string
		let payload: any
		if (anthropicModels.includes(model.id)) {
			url = `${this.options.sapAiCoreBaseUrl}/v2/inference/deployments/${deploymentId}/invoke-with-response-stream`

			// Format messages for Converse API. Note that the Invoke API has
			// the same format for messages as the Converse API.
			const formattedMessages = Bedrock.formatMessagesForConverseAPI(messages)

			// Get message indices for caching
			const userMsgIndices = messages.reduce(
				(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
				[] as number[],
			)
			const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
			const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

			if (
				model.id === "anthropic--claude-4-sonnet" ||
				model.id === "anthropic--claude-4-opus" ||
				model.id === "anthropic--claude-3.7-sonnet"
			) {
				// Use converse-stream endpoint with caching support
				url = `${this.options.sapAiCoreBaseUrl}/v2/inference/deployments/${deploymentId}/converse-stream`

				// Apply caching controls to messages (enabled by default)
				const messagesWithCache = Bedrock.applyCacheControlToMessages(
					formattedMessages,
					lastUserMsgIndex,
					secondLastMsgUserIndex,
				)

				// Prepare system message with caching support (enabled by default)
				const systemMessages = Bedrock.prepareSystemMessages(systemPrompt, true)

				payload = {
					inferenceConfig: {
						maxTokens: model.info.maxTokens,
						temperature: 0.0,
					},
					system: systemMessages,
					messages: messagesWithCache,
				}
			} else {
				// Use invoke-with-response-stream endpoint
				// TODO: add caching support using Anthropic-native cache_control blocks
				payload = {
					max_tokens: model.info.maxTokens,
					system: systemPrompt,
					messages,
					anthropic_version: "bedrock-2023-05-31",
				}
			}
		} else if (openAIModels.includes(model.id)) {
			let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				...convertToOpenAiMessages(messages),
			]

			url = `${this.options.sapAiCoreBaseUrl}/v2/inference/deployments/${deploymentId}/chat/completions?api-version=2024-12-01-preview`
			payload = {
				stream: true,
				messages: openAiMessages,
				max_tokens: model.info.maxTokens,
				temperature: 0.0,
				frequency_penalty: 0,
				presence_penalty: 0,
				stop: null,
				stream_options: { include_usage: true },
			}

			if (["o1", "o3-mini", "o3", "o4-mini", "gpt-5", "gpt-5-nano", "gpt-5-mini"].includes(model.id)) {
				delete payload.max_tokens
				delete payload.temperature
			}

			if (model.id === "o3-mini") {
				delete payload.stream
				delete payload.stream_options
			}
		} else if (geminiModels.includes(model.id)) {
			url = `${this.options.sapAiCoreBaseUrl}/v2/inference/deployments/${deploymentId}/models/${model.id}:streamGenerateContent`
			payload = Gemini.prepareRequestPayload(systemPrompt, messages, model, this.options.thinkingBudgetTokens)
		} else {
			throw new Error(`Unsupported model: ${model.id}`)
		}

		try {
			const response = await axios.post(url, JSON.stringify(payload, null, 2), {
				headers,
				responseType: "stream",
			})

			if (model.id === "o3-mini") {
				const response = await axios.post(url, JSON.stringify(payload, null, 2), { headers })

				// Yield the usage information
				if (response.data.usage) {
					yield {
						type: "usage",
						inputTokens: response.data.usage.prompt_tokens,
						outputTokens: response.data.usage.completion_tokens,
					}
				}

				// Yield the content
				if (response.data.choices && response.data.choices.length > 0) {
					yield {
						type: "text",
						text: response.data.choices[0].message.content,
					}
				}

				// Final usage yield
				if (response.data.usage) {
					yield {
						type: "usage",
						inputTokens: response.data.usage.prompt_tokens,
						outputTokens: response.data.usage.completion_tokens,
					}
				}
			} else if (openAIModels.includes(model.id)) {
				yield* this.streamCompletionGPT(response.data, model)
			} else if (
				model.id === "anthropic--claude-4-sonnet" ||
				model.id === "anthropic--claude-4-opus" ||
				model.id === "anthropic--claude-3.7-sonnet"
			) {
				yield* this.streamCompletionSonnet37(response.data, model)
			} else if (geminiModels.includes(model.id)) {
				yield* this.streamCompletionGemini(response.data, model)
			} else {
				yield* this.streamCompletion(response.data, model)
			}
		} catch (error) {
			if (error.response) {
				// The request was made and the server responded with a status code
				// that falls out of the range of 2xx
				console.error("Error status:", error.response.status)
				console.error("Error data:", error.response.data)
				console.error("Error headers:", error.response.headers)

				if (error.response.status === 404) {
					console.error("404 Error reason:", error.response.data)
					throw new Error(`404 Not Found: ${error.response.data}`)
				}
			} else if (error.request) {
				// The request was made but no response was received
				console.error("Error request:", error.request)
				throw new Error("No response received from server")
			} else {
				// Something happened in setting up the request that triggered an Error
				console.error("Error message:", error.message)
				throw new Error(`Error setting up request: ${error.message}`)
			}

			throw new Error("Failed to create message")
		}
	}

	private async *streamCompletion(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo },
	): AsyncGenerator<any, void, unknown> {
		let usage = { input_tokens: 0, output_tokens: 0 }

		try {
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6)
						try {
							const data = JSON.parse(jsonData)
							if (data.type === "message_start") {
								usage.input_tokens = data.message.usage.input_tokens
								yield {
									type: "usage",
									inputTokens: usage.input_tokens,
									outputTokens: usage.output_tokens,
								}
							} else if (data.type === "content_block_start" || data.type === "content_block_delta") {
								const contentBlock = data.type === "content_block_start" ? data.content_block : data.delta

								if (contentBlock.type === "text" || contentBlock.type === "text_delta") {
									yield {
										type: "text",
										text: contentBlock.text || "",
									}
								}
							} else if (data.type === "message_delta") {
								if (data.usage) {
									usage.output_tokens = data.usage.output_tokens
									yield {
										type: "usage",
										inputTokens: 0,
										outputTokens: data.usage.output_tokens,
									}
								}
							}
						} catch (error) {
							console.error("Failed to parse JSON data:", error)
						}
					}
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			throw error
		}
	}

	private async *streamCompletionSonnet37(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo },
	): AsyncGenerator<any, void, unknown> {
		function toStrictJson(str: string): string {
			// Wrap it in parentheses so JS will treat it as an expression
			const obj = new Function("return " + str)()
			return JSON.stringify(obj)
		}

		let usage = { input_tokens: 0, output_tokens: 0 }

		try {
			// Iterate over the stream and process each chunk
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6)

						try {
							// Parse the incoming JSON data from the stream
							const data = JSON.parse(toStrictJson(jsonData))

							// Handle metadata (token usage)
							if (data.metadata?.usage) {
								let inputTokens = data.metadata.usage.inputTokens || 0
								const outputTokens = data.metadata.usage.outputTokens || 0

								// calibrate input token
								const totalTokens = data.metadata.usage.totalTokens || 0
								const cacheReadInputTokens = data.metadata.usage.cacheReadInputTokens || 0
								const cacheWriteOutputTokens = data.metadata.usage.cacheWriteOutputTokens || 0
								if (inputTokens + outputTokens + cacheReadInputTokens + cacheWriteOutputTokens !== totalTokens) {
									inputTokens = totalTokens - outputTokens - cacheReadInputTokens - cacheWriteOutputTokens
								}

								yield {
									type: "usage",
									inputTokens,
									outputTokens,
								}
							}

							// Handle content block delta (text generation)
							if (data.contentBlockDelta) {
								if (data.contentBlockDelta?.delta?.text) {
									yield {
										type: "text",
										text: data.contentBlockDelta.delta.text,
									}
								}

								// Handle reasoning content if present
								if (data.contentBlockDelta?.delta?.reasoningContent?.text) {
									yield {
										type: "reasoning",
										reasoning: data.contentBlockDelta.delta.reasoningContent.text,
									}
								}
							}
						} catch (error) {
							console.error("Failed to parse JSON data:", error)
							yield {
								type: "text",
								text: `[ERROR] Failed to parse response data: ${error instanceof Error ? error.message : String(error)}`,
							}
						}
					}
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			yield {
				type: "text",
				text: `[ERROR] Failed to process stream: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	private async *streamCompletionGPT(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo },
	): AsyncGenerator<any, void, unknown> {
		let currentContent = ""
		let inputTokens = 0
		let outputTokens = 0

		try {
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)
				for (const line of lines) {
					if (line.trim() === "data: [DONE]") {
						// End of stream, yield final usage
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
						}
						return
					}

					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6)
						try {
							const data = JSON.parse(jsonData)

							if (data.choices && data.choices.length > 0) {
								const choice = data.choices[0]
								if (choice.delta && choice.delta.content) {
									yield {
										type: "text",
										text: choice.delta.content,
									}
									currentContent += choice.delta.content
								}
							}

							// Handle usage information
							if (data.usage) {
								inputTokens = data.usage.prompt_tokens || inputTokens
								outputTokens = data.usage.completion_tokens || outputTokens
								yield {
									type: "usage",
									inputTokens,
									outputTokens,
								}
							}

							if (data.choices?.[0]?.finish_reason === "stop") {
								// Final usage yield, if not already provided
								if (!data.usage) {
									yield {
										type: "usage",
										inputTokens,
										outputTokens,
									}
								}
							}
						} catch (error) {
							console.error("Failed to parse GPT JSON data:", error)
						}
					}
				}
			}
		} catch (error) {
			console.error("Error streaming GPT completion:", error)
			throw error
		}
	}

	private async *streamCompletionGemini(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo },
	): AsyncGenerator<any, void, unknown> {
		let promptTokens = 0
		let outputTokens = 0
		let cacheReadTokens = 0
		let thoughtsTokenCount = 0

		try {
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6)
						try {
							const data = JSON.parse(jsonData)

							// Use Gemini namespace to process the chunk
							const processed = Gemini.processStreamChunk(data)

							// Yield reasoning if present
							if (processed.reasoning) {
								yield {
									type: "reasoning",
									reasoning: processed.reasoning,
								}
							}

							// Yield text if present
							if (processed.text) {
								yield {
									type: "text",
									text: processed.text,
								}
							}

							if (processed.usageMetadata) {
								promptTokens = processed.usageMetadata.promptTokenCount ?? promptTokens
								outputTokens = processed.usageMetadata.candidatesTokenCount ?? outputTokens
								thoughtsTokenCount = processed.usageMetadata.thoughtsTokenCount ?? thoughtsTokenCount
								cacheReadTokens = processed.usageMetadata.cachedContentTokenCount ?? cacheReadTokens

								yield {
									type: "usage",
									inputTokens: promptTokens - cacheReadTokens,
									outputTokens,
									thoughtsTokenCount,
									cacheReadTokens,
									cacheWriteTokens: 0,
								}
							}
						} catch (error) {
							console.error("Failed to parse Gemini JSON data:", error)
						}
					}
				}
			}
		} catch (error) {
			console.error("Error streaming Gemini completion:", error)
			throw error
		}
	}

	createUserReadableRequest(
		userContent: Array<
			Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
		>,
	): any {
		return {
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			system: "(see SYSTEM_PROMPT in src/ClaudeDev.ts)",
			messages: [{ conversation_history: "..." }, { role: "user", content: userContent }],
			tools: "(see tools in src/ClaudeDev.ts)",
			tool_choice: { type: "auto" },
		}
	}

	getModel(): { id: SapAiCoreModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in sapAiCoreModels) {
			const id = modelId as SapAiCoreModelId
			return { id, info: sapAiCoreModels[id] }
		}
		return { id: sapAiCoreDefaultModelId, info: sapAiCoreModels[sapAiCoreDefaultModelId] }
	}
}
