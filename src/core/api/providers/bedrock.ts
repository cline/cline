// Import proper AWS SDK types
import type { ContentBlock, Message } from "@aws-sdk/client-bedrock-runtime"
import {
	BedrockRuntimeClient,
	ConversationRole,
	ConverseCommand,
	ConverseStreamCommand,
	InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { BedrockModelId, bedrockDefaultModelId, bedrockModels, CLAUDE_SONNET_1M_SUFFIX, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI, calculateApiCostQwen } from "@utils/cost"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"

export interface AwsBedrockHandlerOptions extends CommonApiHandlerOptions {
	apiModelId?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsAuthentication?: string
	awsBedrockApiKey?: string
	awsUseCrossRegionInference?: boolean
	awsUseGlobalInference?: boolean
	awsBedrockUsePromptCache?: boolean
	awsUseProfile?: boolean
	awsProfile?: string
	awsBedrockEndpoint?: string
	awsBedrockCustomSelected?: boolean
	awsBedrockCustomModelBaseId?: string
	thinkingBudgetTokens?: number
}

// Extend AWS SDK types to include additionalModelResponseFields
interface ExtendedMetadata {
	usage?: {
		inputTokens?: number
		outputTokens?: number
		cacheReadInputTokens?: number
		cacheWriteInputTokens?: number
	}
	additionalModelResponseFields?: {
		thinkingResponse?: {
			reasoning?: Array<{
				type: string
				text?: string
				signature?: string
			}>
		}
	}
}

// Define types for stream response content blocks
interface ContentBlockStart {
	contentBlockIndex?: number
	start?: {
		type?: string
		thinking?: string
	}
	contentBlock?: {
		type?: string
		thinking?: string
	}
	type?: string
	thinking?: string
}

// Define types for stream response deltas
interface ContentBlockDelta {
	contentBlockIndex?: number
	delta?: {
		type?: string
		thinking?: string
		text?: string
		reasoningContent?: {
			text?: string
		}
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

// Define cache point type for AWS Bedrock
interface CachePointContentBlock {
	cachePoint: {
		type: "default"
	}
}

// Define provider options type based on AWS SDK patterns
interface ProviderChainOptions {
	clientConfig?: { userAgentAppId?: string }
	ignoreCache?: boolean
	profile?: string
}

// a special jp inference profile was created for sonnet 4.5
// https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html
const JP_SUPPORTED_CRIS_MODELS = ["anthropic.claude-sonnet-4-5-20250929-v1:0", "anthropic.claude-sonnet-4-5-20250929-v1:0:1m"]

// https://docs.anthropic.com/en/api/claude-on-amazon-bedrock
export class AwsBedrockHandler implements ApiHandler {
	private options: AwsBedrockHandlerOptions

	constructor(options: AwsBedrockHandlerOptions) {
		this.options = options
	}

	@withRetry({ maxRetries: 4 })
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		// cross region inference requires prefixing the model id with the region
		const rawModelId = await this.getModelId()

		const modelId = rawModelId.endsWith(CLAUDE_SONNET_1M_SUFFIX)
			? rawModelId.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length)
			: rawModelId

		const enable1mContextWindow = rawModelId.endsWith(CLAUDE_SONNET_1M_SUFFIX)

		const model = this.getModel()

		// This baseModelId is used to indicate the capabilities of the model.
		// If the user selects a custom model, baseModelId will be set to the base model ID of the custom model.
		// Otherwise, baseModelId will be the same as modelId.
		const baseModelId =
			(this.options.awsBedrockCustomSelected ? this.options.awsBedrockCustomModelBaseId : modelId) || modelId

		// Check if this is an Amazon Nova model
		if (baseModelId.includes("amazon.nova")) {
			yield* this.createNovaMessage(systemPrompt, messages, modelId, model)
			return
		}

		if (baseModelId.includes("openai")) {
			yield* this.createOpenAIMessage(systemPrompt, messages, modelId, model)
			return
		}

		// Check if this is a Qwen model
		if (baseModelId.includes("qwen")) {
			yield* this.createQwenMessage(systemPrompt, messages, modelId, model)
			return
		}

		// Check if this is a Deepseek model
		if (baseModelId.includes("deepseek")) {
			yield* this.createDeepseekMessage(systemPrompt, messages, modelId, model)
			return
		}

		// Default: Use Anthropic Converse API for all Anthropic models
		yield* this.createAnthropicMessage(systemPrompt, messages, modelId, model, enable1mContextWindow)
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bedrockModels) {
			const id = modelId as BedrockModelId
			return { id, info: bedrockModels[id] }
		}

		const customSelected = this.options.awsBedrockCustomSelected
		const baseModel = this.options.awsBedrockCustomModelBaseId

		// Handle custom models
		if (customSelected && modelId) {
			// If base model is provided and valid, use its capabilities
			if (baseModel && baseModel in bedrockModels) {
				return {
					id: modelId,
					info: bedrockModels[baseModel as BedrockModelId],
				}
			}
			// For custom models without valid base model in bedrock model list, use default model's capabilities
			return {
				id: modelId,
				info: bedrockModels[bedrockDefaultModelId],
			}
		}

		return {
			id: bedrockDefaultModelId,
			info: bedrockModels[bedrockDefaultModelId],
		}
	}

	// Default AWS region
	private static readonly DEFAULT_REGION = "us-east-1"

	/**
	 * Gets AWS credentials using the provider chain
	 * Centralizes credential retrieval logic for all AWS services
	 */
	private async getAwsCredentials(): Promise<{
		accessKeyId: string
		secretAccessKey: string
		sessionToken?: string
	}> {
		// Configure provider options
		const providerOptions: ProviderChainOptions = {
			clientConfig: {
				// set the inner sts client userAgentAppId
				userAgentAppId: `cline#${ExtensionRegistryInfo.version}`,
			},
		}
		const useProfile =
			(this.options.awsAuthentication === undefined && this.options.awsUseProfile) ||
			this.options.awsAuthentication === "profile"
		if (useProfile) {
			// For profile-based auth, always use ignoreCache to detect credential file changes
			// This solves the AWS Identity Manager issue where credential files change externally
			providerOptions.ignoreCache = true
			if (this.options.awsProfile) {
				providerOptions.profile = this.options.awsProfile
			}
		}

		// Create AWS credentials by executing an AWS provider chain
		const providerChain = fromNodeProviderChain(providerOptions)
		return await AwsBedrockHandler.withTempEnv(
			() => {
				AwsBedrockHandler.setEnv("AWS_REGION", this.options.awsRegion)
				if (useProfile) {
					AwsBedrockHandler.setEnv("AWS_PROFILE", this.options.awsProfile)
				} else {
					delete process.env["AWS_PROFILE"]
					AwsBedrockHandler.setEnv("AWS_ACCESS_KEY_ID", this.options.awsAccessKey)
					AwsBedrockHandler.setEnv("AWS_SECRET_ACCESS_KEY", this.options.awsSecretKey)
					AwsBedrockHandler.setEnv("AWS_SESSION_TOKEN", this.options.awsSessionToken)
				}
			},
			() => providerChain(),
		)
	}

	/**
	 * Gets the AWS region to use, with fallback to default
	 */
	private getRegion(): string {
		return this.options.awsRegion || AwsBedrockHandler.DEFAULT_REGION
	}

	/**
	 * Creates a BedrockRuntimeClient with the appropriate credentials
	 */
	private async getBedrockClient(): Promise<BedrockRuntimeClient> {
		let auth: any

		if (this.options.awsAuthentication === "apikey") {
			auth = {
				token: { token: this.options.awsBedrockApiKey },
				authSchemePreference: ["httpBearerAuth"],
			}
		} else {
			const credentials = await this.getAwsCredentials()
			auth = {
				credentials: {
					accessKeyId: credentials.accessKeyId,
					secretAccessKey: credentials.secretAccessKey,
					sessionToken: credentials.sessionToken,
				},
			}
		}

		// TODO: Add proxy support for AWS SDK
		// AWS SDK uses a different architecture than fetch-based SDKs.
		// To add proxy support, we need to provide a custom requestHandler.
		return new BedrockRuntimeClient({
			userAgentAppId: `cline#${ExtensionRegistryInfo.version}`,
			region: this.getRegion(),
			...auth,
			...(this.options.awsBedrockEndpoint && { endpoint: this.options.awsBedrockEndpoint }),
		})
	}

	/**
	 * Gets the appropriate model ID, accounting for cross-region inference if enabled.
	 * For custom models, returns the raw model ID without any encoding.
	 */
	async getModelId(): Promise<string> {
		if (!this.options.awsBedrockCustomSelected && this.options.awsUseCrossRegionInference) {
			if (this.getModel().info.supportsGlobalEndpoint && this.options.awsUseGlobalInference) {
				return `global.${this.getModel().id}`
			}
			const regionPrefix = this.getRegion().slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					return `us.${this.getModel().id}`
				case "eu-":
					return `eu.${this.getModel().id}`
				case "ap-":
					if (JP_SUPPORTED_CRIS_MODELS.includes(this.getModel().id)) {
						return `jp.${this.getModel().id}`
					}
					return `apac.${this.getModel().id}`
				default:
					// cross region inference is not supported in this region, falling back to default model
					return this.getModel().id
			}
		}
		return this.getModel().id
	}

	private static async withTempEnv<R>(updateEnv: () => void, fn: () => Promise<R>): Promise<R> {
		const previousEnv = Object.assign({}, process.env)

		try {
			updateEnv()
			return await fn()
		} finally {
			// Restore the previous environment
			// First clear any new variables that might have been added
			for (const key in process.env) {
				if (!(key in previousEnv)) {
					delete process.env[key]
				}
			}
			// Then restore all previous values
			for (const key in previousEnv) {
				process.env[key] = previousEnv[key]
			}
		}
	}

	private static setEnv(key: string, value: string | undefined) {
		if (key !== "" && value !== undefined) {
			process.env[key] = value
		}
	}

	/**
	 * Creates a message using the Deepseek R1 model through AWS Bedrock
	 */
	private async *createDeepseekMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		modelId: string,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()

		// Format prompt for DeepSeek R1 according to documentation
		const formattedPrompt = this.formatDeepseekR1Prompt(systemPrompt, messages)

		// Prepare the request based on DeepSeek R1's expected format
		const command = new InvokeModelWithResponseStreamCommand({
			modelId: modelId,
			contentType: "application/json",
			accept: "application/json",
			body: JSON.stringify({
				prompt: formattedPrompt,
				max_tokens: model.info.maxTokens || 8000,
				temperature: 0,
			}),
		})

		// Track token usage
		const inputTokenEstimate = this.estimateInputTokens(systemPrompt, messages)
		let outputTokens = 0
		let isFirstChunk = true
		let accumulatedTokens = 0
		const TOKEN_REPORT_THRESHOLD = 100 // Report usage after accumulating this many tokens

		// Execute the streaming request
		const response = await client.send(command)

		if (response.body) {
			for await (const chunk of response.body) {
				if (chunk.chunk?.bytes) {
					try {
						// Parse the response chunk
						const decodedChunk = new TextDecoder().decode(chunk.chunk.bytes)
						const parsedChunk = JSON.parse(decodedChunk)

						// Report usage on first chunk
						if (isFirstChunk) {
							isFirstChunk = false
							const totalCost = calculateApiCostOpenAI(model.info, inputTokenEstimate, 0, 0, 0)
							yield {
								type: "usage",
								inputTokens: inputTokenEstimate,
								outputTokens: 0,
								totalCost: totalCost,
							}
						}

						// Handle DeepSeek R1 response format
						if (parsedChunk.choices && parsedChunk.choices.length > 0) {
							// For non-streaming response (full response)
							const text = parsedChunk.choices[0].text
							if (text) {
								const chunkTokens = this.estimateTokenCount(text)
								outputTokens += chunkTokens
								accumulatedTokens += chunkTokens

								yield {
									type: "text",
									text: text,
								}

								if (accumulatedTokens >= TOKEN_REPORT_THRESHOLD) {
									const totalCost = calculateApiCostOpenAI(model.info, 0, accumulatedTokens, 0, 0)
									yield {
										type: "usage",
										inputTokens: 0,
										outputTokens: accumulatedTokens,
										totalCost: totalCost,
									}
									accumulatedTokens = 0
								}
							}
						} else if (parsedChunk.delta?.text) {
							// For streaming response (delta updates)
							const text = parsedChunk.delta.text
							const chunkTokens = this.estimateTokenCount(text)
							outputTokens += chunkTokens
							accumulatedTokens += chunkTokens

							yield {
								type: "text",
								text: text,
							}
							// Report aggregated token usage only when threshold is reached
							if (accumulatedTokens >= TOKEN_REPORT_THRESHOLD) {
								const totalCost = calculateApiCostOpenAI(model.info, 0, accumulatedTokens, 0, 0)
								yield {
									type: "usage",
									inputTokens: 0,
									outputTokens: accumulatedTokens,
									totalCost: totalCost,
								}
								accumulatedTokens = 0
							}
						}
					} catch (error) {
						console.error("Error parsing Deepseek response chunk:", error)
						// Propagate the error by yielding a text response with error information
						yield {
							type: "text",
							text: `[ERROR] Failed to parse Deepseek response: ${error instanceof Error ? error.message : String(error)}`,
						}
					}
				}
			}

			// Report any remaining accumulated tokens at the end of the stream
			if (accumulatedTokens > 0) {
				const totalCost = calculateApiCostOpenAI(model.info, 0, accumulatedTokens, 0, 0)
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: accumulatedTokens,
					totalCost: totalCost,
				}
			}

			// Add final total cost calculation that includes both input and output tokens
			const finalTotalCost = calculateApiCostOpenAI(model.info, inputTokenEstimate, outputTokens, 0, 0)
			yield {
				type: "usage",
				inputTokens: inputTokenEstimate,
				outputTokens: outputTokens,
				totalCost: finalTotalCost,
			}
		}
	}

	/**
	 * Formats prompt for DeepSeek R1 model according to documentation
	 * First uses convertToR1Format to merge consecutive messages with the same role,
	 * then converts to the string format that DeepSeek R1 expects
	 */
	private formatDeepseekR1Prompt(systemPrompt: string, messages: ClineStorageMessage[]): string {
		// First use convertToR1Format to merge consecutive messages with the same role
		const r1Messages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])

		// Then convert to the special string format expected by DeepSeek R1
		let combinedContent = ""

		for (const message of r1Messages) {
			let content = ""

			if (message.content) {
				if (typeof message.content === "string") {
					content = message.content
				} else {
					// Extract text content from message parts
					content = message.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n")
				}
			}

			combinedContent += message.role === "user" ? "User: " + content + "\n" : "Assistant: " + content + "\n"
		}

		// Format according to DeepSeek R1's expected prompt format
		return `<｜begin▁of▁sentence｜><｜User｜>${combinedContent}<｜Assistant｜><think>\n`
	}

	/**
	 * Estimates token count based on text length (approximate)
	 * Note: This is a rough estimation, as the actual token count depends on the tokenizer
	 */
	private estimateInputTokens(systemPrompt: string, messages: ClineStorageMessage[]): number {
		// For Deepseek R1, we estimate the token count of the formatted prompt
		// The formatted prompt includes special tokens and consistent formatting
		const formattedPrompt = this.formatDeepseekR1Prompt(systemPrompt, messages)
		return Math.ceil(formattedPrompt.length / 4)
	}

	/**
	 * Estimates token count for a text string
	 */
	private estimateTokenCount(text: string): number {
		// Approximate 4 characters per token
		return Math.ceil(text.length / 4)
	}

	/**
	 * Executes a Converse API stream command and handles the response
	 * Common implementation for both Anthropic and Nova models
	 */
	private async *executeConverseStream(command: ConverseStreamCommand, modelInfo: ModelInfo): ApiStream {
		try {
			const client = await this.getBedrockClient()
			const response = await client.send(command)

			if (response.stream) {
				// Buffer content by contentBlockIndex to handle multi-block responses correctly
				const contentBuffers: Record<number, string> = {}
				const blockTypes = new Map<number, "reasoning" | "text">()

				for await (const chunk of response.stream) {
					// Debug logging to see actual response structure
					// console.log("Bedrock chunk:", JSON.stringify(chunk, null, 2))

					// Handle thinking response in additionalModelResponseFields (LangChain format)
					const metadata = chunk.metadata as ExtendedMetadata | undefined
					if (metadata?.additionalModelResponseFields?.thinkingResponse) {
						const thinkingResponse = metadata.additionalModelResponseFields.thinkingResponse
						if (thinkingResponse.reasoning && Array.isArray(thinkingResponse.reasoning)) {
							for (const reasoningBlock of thinkingResponse.reasoning) {
								if (reasoningBlock.type === "text" && reasoningBlock.text) {
									yield {
										type: "reasoning",
										reasoning: reasoningBlock.text,
									}
								}
							}
						}
					}

					// Handle metadata events with token usage information
					if (chunk.metadata?.usage) {
						const inputTokens = chunk.metadata.usage.inputTokens || 0
						const outputTokens = chunk.metadata.usage.outputTokens || 0
						const cacheReadInputTokens = chunk.metadata.usage.cacheReadInputTokens || 0
						const cacheWriteInputTokens = chunk.metadata.usage.cacheWriteInputTokens || 0

						yield {
							type: "usage",
							inputTokens,
							outputTokens,
							cacheReadTokens: cacheReadInputTokens,
							cacheWriteTokens: cacheWriteInputTokens,
							totalCost: calculateApiCostOpenAI(
								modelInfo,
								inputTokens,
								outputTokens,
								cacheWriteInputTokens,
								cacheReadInputTokens,
							),
						}
					}

					// Handle content block start - check if Bedrock uses Anthropic SDK format
					if (chunk.contentBlockStart) {
						const blockStart = chunk.contentBlockStart as ContentBlockStart
						const blockIndex = chunk.contentBlockStart.contentBlockIndex

						// Check for thinking block in various possible formats
						if (
							blockStart.start?.type === "thinking" ||
							blockStart.contentBlock?.type === "thinking" ||
							blockStart.type === "thinking"
						) {
							if (blockIndex !== undefined) {
								blockTypes.set(blockIndex, "reasoning")
								// Initialize content if provided
								const initialContent =
									blockStart.start?.thinking || blockStart.contentBlock?.thinking || blockStart.thinking || ""
								if (initialContent) {
									yield {
										type: "reasoning",
										reasoning: initialContent,
									}
								}
							}
						}
					}

					// Handle content block delta - accumulate content by block index
					if (chunk.contentBlockDelta) {
						const blockIndex = chunk.contentBlockDelta.contentBlockIndex

						if (blockIndex !== undefined) {
							// Initialize buffer for this block if it doesn't exist
							if (!(blockIndex in contentBuffers)) {
								contentBuffers[blockIndex] = ""
							}

							// Check if this is a thinking block
							const blockType = blockTypes.get(blockIndex)
							const delta = chunk.contentBlockDelta.delta as ContentBlockDelta["delta"]

							// Handle thinking delta (Anthropic SDK format)
							if (delta?.type === "thinking_delta" || delta?.thinking) {
								const thinkingContent = delta.thinking || delta.text || ""
								if (thinkingContent) {
									yield {
										type: "reasoning",
										reasoning: thinkingContent,
									}
								}
							} else if (delta?.reasoningContent?.text) {
								// Handle reasoning content (Bedrock format)
								const reasoningText = delta.reasoningContent.text
								if (reasoningText) {
									yield {
										type: "reasoning",
										reasoning: reasoningText,
									}
								}
							} else if (chunk.contentBlockDelta.delta?.text) {
								// Handle regular text content
								const textContent = chunk.contentBlockDelta.delta.text
								contentBuffers[blockIndex] += textContent

								// Stream based on block type
								if (blockType === "reasoning") {
									yield {
										type: "reasoning",
										reasoning: textContent,
									}
								} else {
									yield {
										type: "text",
										text: textContent,
									}
								}
							}
						}
					}

					// Handle content block stop - clean up buffers
					if (chunk.contentBlockStop) {
						const blockIndex = chunk.contentBlockStop.contentBlockIndex

						if (blockIndex !== undefined) {
							// Clean up buffers and tracking for this block
							delete contentBuffers[blockIndex]
							blockTypes.delete(blockIndex)
						}
					}

					// Handle errors with unified error handling
					yield* this.handleBedrockStreamError(chunk)
				}
			}
		} catch (error) {
			throw error
		}
	}

	/**
	 * Handles Bedrock stream errors in a unified way
	 */
	private *handleBedrockStreamError(chunk: any): Generator<{ type: "text"; text: string }> {
		if (chunk.internalServerException) {
			yield {
				type: "text",
				text: `[ERROR] Internal server error: ${chunk.internalServerException.message}`,
			}
		} else if (chunk.modelStreamErrorException) {
			yield {
				type: "text",
				text: `[ERROR] Model stream error: ${chunk.modelStreamErrorException.message}`,
			}
		} else if (chunk.validationException) {
			// Check if this is a context window error - if so, throw it
			// so the retry mechanism can handle truncation
			const message = chunk.validationException.message || ""
			const isContextError = /input.*too long|context.*exceed|maximum.*token|input length.*max.*tokens/i.test(message)

			if (isContextError) {
				// Throw as exception so context management can handle it
				throw chunk.validationException
			}

			// Otherwise yield as error text
			yield {
				type: "text",
				text: `[ERROR] Validation error: ${message}`,
			}
		} else if (chunk.throttlingException) {
			yield {
				type: "text",
				text: `[ERROR] Throttling error: ${chunk.throttlingException.message}`,
			}
		} else if (chunk.serviceUnavailableException) {
			yield {
				type: "text",
				text: `[ERROR] Service unavailable: ${chunk.serviceUnavailableException.message}`,
			}
		}
	}

	/**
	 * Prepares system messages with optional caching support
	 */
	private prepareSystemMessages(systemPrompt: string, enableCaching: boolean): any[] | undefined {
		if (!systemPrompt) {
			return undefined
		}

		if (enableCaching) {
			return [{ text: systemPrompt }, { cachePoint: { type: "default" } }]
		}

		return [{ text: systemPrompt }]
	}

	/**
	 * Gets inference configuration for different model types
	 */
	private getInferenceConfig(modelInfo: ModelInfo, modelType: "anthropic" | "nova"): any {
		// For Anthropic models with thinking enabled, temperature must be 1
		if (modelType === "anthropic") {
			const budget_tokens = this.options.thinkingBudgetTokens || 0
			const reasoningOn = modelInfo.supportsReasoning && budget_tokens > 0

			return {
				maxTokens: modelInfo.maxTokens || 8192,
				temperature: reasoningOn ? 1 : 0,
			}
		}

		return {
			maxTokens: modelInfo.maxTokens || (modelType === "nova" ? 5000 : 8192),
			temperature: 0,
		}
	}

	/**
	 * Creates a message using Anthropic Claude models through AWS Bedrock Converse API
	 * Implements support for Anthropic Claude models using the unified Converse API
	 */
	private async *createAnthropicMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		modelId: string,
		model: { id: string; info: ModelInfo },
		enable1mContextWindow: boolean,
	): ApiStream {
		// Format messages for Anthropic model using unified formatter
		const formattedMessages = this.formatMessagesForConverseAPI(messages)

		// Get model info and message indices for caching
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Apply caching controls to messages if enabled
		const messagesWithCache = this.options.awsBedrockUsePromptCache
			? this.applyCacheControlToMessages(formattedMessages, lastUserMsgIndex, secondLastMsgUserIndex)
			: formattedMessages

		// Prepare system message with caching support
		const systemMessages = this.prepareSystemMessages(systemPrompt, this.options.awsBedrockUsePromptCache || false)

		// Get thinking configuration
		const budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = model.info.supportsReasoning && budget_tokens > 0

		// Prepare request for Anthropic model using Converse API
		const command = new ConverseStreamCommand({
			modelId: modelId,
			messages: messagesWithCache,
			system: systemMessages,
			inferenceConfig: this.getInferenceConfig(model.info, "anthropic"),
			additionalModelRequestFields: {
				// Add thinking configuration as per LangChain documentation
				...(reasoningOn && {
					thinking: {
						type: "enabled",
						budget_tokens: budget_tokens,
					},
				}),
				...(enable1mContextWindow && {
					anthropic_beta: ["context-1m-2025-08-07"],
				}),
			},
		})

		// Execute the streaming request using unified handler
		yield* this.executeConverseStream(command, model.info)
	}

	/**
	 * Formats messages for models using the Converse API specification
	 * Used by both Anthropic and Nova models to avoid code duplication
	 */
	private formatMessagesForConverseAPI(messages: ClineStorageMessage[]): Message[] {
		return messages.map((message) => {
			// Determine role (user or assistant)
			const role = message.role === "user" ? ConversationRole.USER : ConversationRole.ASSISTANT

			// Process content based on type
			let content: ContentBlock[] = []

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
							return this.processImageContent(item)
						}

						// Log unsupported content types for debugging
						console.warn(`Unsupported content type: ${(item as ContentItem).type}`)
						return null
					})
					.filter((item): item is ContentBlock => item !== null)

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
	private processImageContent(item: any): ContentBlock | null {
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

	/**
	 * Applies cache control to messages for prompt caching using AWS Bedrock's cachePoint system
	 * AWS Bedrock uses cachePoint objects instead of Anthropic's cache_control approach
	 */
	private applyCacheControlToMessages(
		messages: Message[],
		lastUserMsgIndex: number,
		secondLastMsgUserIndex: number,
	): Message[] {
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
	 * Creates a message using Amazon Nova models through AWS Bedrock
	 * Implements support for Amazon Nova models with caching support
	 */
	private async *createNovaMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		modelId: string,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		// Format messages for Nova model using unified formatter
		const formattedMessages = this.formatMessagesForConverseAPI(messages)

		// Get model info and message indices for caching (for Nova models that support it)
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Apply caching controls to messages if model supports caching and option is enabled
		const messagesWithCache =
			this.options.awsBedrockUsePromptCache && model.info.supportsPromptCache
				? this.applyCacheControlToMessages(formattedMessages, lastUserMsgIndex, secondLastMsgUserIndex)
				: formattedMessages

		// Prepare system message with caching support for Nova models that support it
		const enableCaching = this.options.awsBedrockUsePromptCache && model.info.supportsPromptCache
		const systemMessages = this.prepareSystemMessages(systemPrompt, enableCaching || false)

		// Prepare request for Nova model
		const command = new ConverseStreamCommand({
			modelId: modelId,
			messages: messagesWithCache,
			system: systemMessages,
			inferenceConfig: this.getInferenceConfig(model.info, "nova"),
		})

		// Execute the streaming request using unified handler
		yield* this.executeConverseStream(command, model.info)
	}

	/**
	 * Creates a message using OpenAI models through AWS Bedrock
	 * Uses non-streaming Converse API and simulates streaming for models that don't support it
	 */
	private async *createOpenAIMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		modelId: string,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()

		// Format messages for Converse API
		const formattedMessages = this.formatMessagesForConverseAPI(messages)

		// Prepare system message
		const systemMessages = systemPrompt ? [{ text: systemPrompt }] : undefined

		// Prepare the non-streaming Converse command
		const command = new ConverseCommand({
			modelId: modelId,
			messages: formattedMessages,
			system: systemMessages,
			inferenceConfig: {
				maxTokens: model.info.maxTokens || 8192,
				temperature: 0,
			},
		})

		try {
			// Track token usage
			const inputTokenEstimate = this.estimateInputTokens(systemPrompt, messages)
			let outputTokens = 0

			// Execute the non-streaming request
			const response = await client.send(command)

			// Extract the complete response text and reasoning content
			let fullText = ""
			let reasoningText = ""

			if (response.output?.message?.content) {
				for (const contentBlock of response.output.message.content) {
					// Check for reasoning content first
					if ("reasoningContent" in contentBlock && contentBlock.reasoningContent) {
						// Handle nested reasoning structure
						const reasoning = contentBlock.reasoningContent
						if ("reasoningText" in reasoning && reasoning.reasoningText && "text" in reasoning.reasoningText) {
							reasoningText += reasoning.reasoningText.text
						}
					}
					// Handle regular text content
					else if ("text" in contentBlock && contentBlock.text) {
						fullText += contentBlock.text
					}
				}
			}

			// If we have actual usage data from the response, use it
			if (response.usage) {
				const actualInputTokens = response.usage.inputTokens || inputTokenEstimate
				const actualOutputTokens = response.usage.outputTokens || this.estimateTokenCount(fullText + reasoningText)
				outputTokens = actualOutputTokens

				// Report actual usage after processing content
				const actualCost = calculateApiCostOpenAI(model.info, actualInputTokens, actualOutputTokens, 0, 0)
				yield {
					type: "usage",
					inputTokens: actualInputTokens,
					outputTokens: actualOutputTokens,
					totalCost: actualCost,
				}
			} else {
				// Estimate output tokens if not provided (includes both regular text and reasoning)
				outputTokens = this.estimateTokenCount(fullText + reasoningText)
			}

			// Yield reasoning content first if present
			if (reasoningText) {
				const reasoningChunkSize = 1000 // Characters per chunk
				for (let i = 0; i < reasoningText.length; i += reasoningChunkSize) {
					const chunk = reasoningText.slice(i, Math.min(i + reasoningChunkSize, reasoningText.length))

					yield {
						type: "reasoning",
						reasoning: chunk,
					}
				}
			}

			// Simulate streaming by chunking the response text
			if (fullText) {
				const chunkSize = 1000 // Characters per chunk

				for (let i = 0; i < fullText.length; i += chunkSize) {
					const chunk = fullText.slice(i, Math.min(i + chunkSize, fullText.length))

					yield {
						type: "text",
						text: chunk,
					}
				}
			}

			// Report final usage if we didn't have actual usage data earlier
			if (!response.usage) {
				const finalCost = calculateApiCostOpenAI(model.info, inputTokenEstimate, outputTokens, 0, 0)
				yield {
					type: "usage",
					inputTokens: inputTokenEstimate,
					outputTokens: outputTokens,
					totalCost: finalCost,
				}
			}
		} catch (error) {
			console.error("Error with OpenAI model via Converse API:", error)

			// Try to extract more detailed error information
			let errorMessage = "Failed to process OpenAI model request"
			if (error instanceof Error) {
				errorMessage = error.message
				// Check for specific AWS SDK errors
				if ("name" in error) {
					errorMessage = `${error.name}: ${error.message}`
				}
			}

			yield {
				type: "text",
				text: `[ERROR] ${errorMessage}`,
			}
		}
	}

	/**
	 * Creates a message using Qwen models through AWS Bedrock
	 * Uses non-streaming Converse API and simulates streaming for models that don't support it
	 */
	private async *createQwenMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		modelId: string,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()

		// Format messages for Converse API
		const formattedMessages = this.formatMessagesForConverseAPI(messages)

		// Prepare system message
		const systemMessages = systemPrompt ? [{ text: systemPrompt }] : undefined

		// Prepare the non-streaming Converse command
		const command = new ConverseCommand({
			modelId: modelId,
			messages: formattedMessages,
			system: systemMessages,
			inferenceConfig: {
				maxTokens: model.info.maxTokens || 8192,
				temperature: 0,
			},
		})

		try {
			// Track token usage
			const inputTokenEstimate = this.estimateInputTokens(systemPrompt, messages)
			let outputTokens = 0

			// Execute the non-streaming request
			const response = await client.send(command)

			// Extract the complete response text and reasoning content
			let fullText = ""
			let reasoningText = ""

			if (response.output?.message?.content) {
				for (const contentBlock of response.output.message.content) {
					// Check for reasoning content first
					if ("reasoningContent" in contentBlock && contentBlock.reasoningContent) {
						// Handle nested reasoning structure
						const reasoning = contentBlock.reasoningContent
						if ("reasoningText" in reasoning && reasoning.reasoningText && "text" in reasoning.reasoningText) {
							reasoningText += reasoning.reasoningText.text
						}
					}
					// Handle regular text content
					else if ("text" in contentBlock && contentBlock.text) {
						fullText += contentBlock.text
					}
				}
			}

			// If we have actual usage data from the response, use it
			if (response.usage) {
				const actualInputTokens = response.usage.inputTokens || inputTokenEstimate
				const actualOutputTokens = response.usage.outputTokens || this.estimateTokenCount(fullText + reasoningText)
				outputTokens = actualOutputTokens

				// Report actual usage after processing content
				const actualCost = calculateApiCostQwen(model.info, actualInputTokens, actualOutputTokens, 0, 0)
				yield {
					type: "usage",
					inputTokens: actualInputTokens,
					outputTokens: actualOutputTokens,
					totalCost: actualCost,
				}
			} else {
				// Estimate output tokens if not provided (includes both regular text and reasoning)
				outputTokens = this.estimateTokenCount(fullText + reasoningText)
			}

			// Yield reasoning content first if present
			if (reasoningText) {
				const reasoningChunkSize = 1000 // Characters per chunk
				for (let i = 0; i < reasoningText.length; i += reasoningChunkSize) {
					const chunk = reasoningText.slice(i, Math.min(i + reasoningChunkSize, reasoningText.length))

					yield {
						type: "reasoning",
						reasoning: chunk,
					}
				}
			}

			// Simulate streaming by chunking the response text
			if (fullText) {
				const chunkSize = 1000 // Characters per chunk

				for (let i = 0; i < fullText.length; i += chunkSize) {
					const chunk = fullText.slice(i, Math.min(i + chunkSize, fullText.length))

					yield {
						type: "text",
						text: chunk,
					}
				}
			}

			// Report final usage if we didn't have actual usage data earlier
			if (!response.usage) {
				const finalCost = calculateApiCostQwen(model.info, inputTokenEstimate, outputTokens, 0, 0)
				yield {
					type: "usage",
					inputTokens: inputTokenEstimate,
					outputTokens: outputTokens,
					totalCost: finalCost,
				}
			}
		} catch (error) {
			console.error("Error with Qwen model via Converse API:", error)

			// Try to extract more detailed error information
			let errorMessage = "Failed to process Qwen model request"
			if (error instanceof Error) {
				errorMessage = error.message
				// Check for specific AWS SDK errors
				if ("name" in error) {
					errorMessage = `${error.name}: ${error.message}`
				}
			}

			yield {
				type: "text",
				text: `[ERROR] ${errorMessage}`,
			}
		}
	}
}
