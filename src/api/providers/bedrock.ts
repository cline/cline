import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { convertToR1Format } from "../transform/r1-format"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { ApiStream, ApiStreamChunk } from "../transform/stream"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { BedrockRuntimeClient, ConversationRole, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime"

// https://docs.anthropic.com/en/api/claude-on-amazon-bedrock
export class AwsBedrockHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// cross region inference requires prefixing the model id with the region
		const modelId = await this.getModelId()
		const model = this.getModel()

		// This baseModelId is used to indicate the capabilities of the model.
		// If the user selects a custom model, baseModelId will be set to the base model ID of the custom model.
		// Otherwise, baseModelId will be the same as modelId.
		const baseModelId =
			(this.options.awsBedrockCustomSelected ? this.options.awsBedrockCustomModelBaseId : modelId) || modelId

		// Check if this is an Amazon Nova model or a DeepSeek model
		if (baseModelId.includes("amazon.nova") || baseModelId.includes("deepseek")) {
			yield* this.createConverseMessage(systemPrompt, messages, modelId, model, baseModelId)
			return
		}

		const budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = baseModelId.includes("3-7") && budget_tokens !== 0 ? true : false

		// Get model info and message indices for caching
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Create anthropic client, using sessions created or renewed after this handler's
		// initialization, and allowing for session renewal if necessary as well
		const client = await this.getAnthropicClient()

		// AWS SDK prioritizes AWS_PROFILE over AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY pair
		// If this is set as an env variable already (ie. from ~/.zshrc) it will override credentials configured by Cline
		const previousEnv = process.env
		delete process.env["AWS_PROFILE"]
		const stream = await client.messages.create({
			model: modelId,
			max_tokens: model.info.maxTokens || 8192,
			thinking: reasoningOn ? { type: "enabled", budget_tokens: budget_tokens } : undefined,
			temperature: reasoningOn ? undefined : 0,
			system: [
				{
					text: systemPrompt,
					type: "text",
					...(this.options.awsBedrockUsePromptCache === true && {
						cache_control: { type: "ephemeral" },
					}),
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
											...(this.options.awsBedrockUsePromptCache === true && {
												cache_control: { type: "ephemeral" },
											}),
										},
									]
								: message.content.map((content, contentIndex) =>
										contentIndex === message.content.length - 1
											? {
													...content,
													...(this.options.awsBedrockUsePromptCache === true && {
														cache_control: { type: "ephemeral" },
													}),
												}
											: content,
									),
					}
				}
				return message
			}),
			stream: true,
		})
		process.env = previousEnv

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
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bedrockModels) {
			const id = modelId as BedrockModelId
			return { id, info: bedrockModels[id] }
		}

		const customSelected = this.options.awsBedrockCustomSelected
		const baseModel = this.options.awsBedrockCustomModelBaseId
		if (customSelected && modelId && baseModel && baseModel in bedrockModels) {
			// Use the user-input model ID but inherit capabilities from the base model
			return {
				id: modelId,
				info: bedrockModels[baseModel],
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
		// Create AWS credentials by executing an AWS provider chain
		const providerChain = fromNodeProviderChain()
		return await AwsBedrockHandler.withTempEnv(
			() => {
				AwsBedrockHandler.setEnv("AWS_REGION", this.options.awsRegion)
				if (this.options.awsUseProfile) {
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
		const credentials = await this.getAwsCredentials()

		return new BedrockRuntimeClient({
			region: this.getRegion(),
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
				sessionToken: credentials.sessionToken,
			},
			...(this.options.awsBedrockEndpoint && { endpoint: this.options.awsBedrockEndpoint }),
		})
	}

	/**
	 * Creates an AnthropicBedrock client with the appropriate credentials
	 */
	private async getAnthropicClient(): Promise<AnthropicBedrock> {
		const credentials = await this.getAwsCredentials()

		// Return an AnthropicBedrock client with the resolved/assumed credentials.
		return new AnthropicBedrock({
			awsAccessKey: credentials.accessKeyId,
			awsSecretKey: credentials.secretAccessKey,
			awsSessionToken: credentials.sessionToken,
			awsRegion: this.getRegion(),
			...(this.options.awsBedrockEndpoint && { baseURL: this.options.awsBedrockEndpoint }),
		})
	}

	/**
	 * Gets the appropriate model ID, accounting for cross-region inference if enabled.
	 * If the model ID is an ARN that contains a slash, you will get the URL encoded ARN.
	 */
	async getModelId(): Promise<string> {
		if (this.options.awsBedrockCustomSelected && this.getModel().id.includes("/")) {
			return encodeURIComponent(this.getModel().id)
		}
		if (!this.options.awsBedrockCustomSelected && this.options.awsUseCrossRegionInference) {
			const regionPrefix = this.getRegion().slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					return `us.${this.getModel().id}`
				case "eu-":
					return `eu.${this.getModel().id}`
				case "ap-":
					return `apac.${this.getModel().id}`
				default:
					// cross region inference is not supported in this region, falling back to default model
					return this.getModel().id
			}
		}
		return this.getModel().id
	}

	private static async withTempEnv<R>(updateEnv: () => void, fn: () => Promise<R>): Promise<R> {
		const previousEnv = { ...process.env }

		try {
			updateEnv()
			return await fn()
		} finally {
			process.env = previousEnv
		}
	}

	private static setEnv(key: string, value: string | undefined) {
		if (key !== "" && value !== undefined) {
			process.env[key] = value
		}
	}

	/**
	 * Creates a message using the Converse API for both Nova and DeepSeek models
	 * This is a unified implementation that handles both model types
	 */
	private async *createConverseMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		model: { id: string; info: ModelInfo },
		baseModelId: string,
	): ApiStream {
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()

		// Format messages for the Converse API
		const formattedResult = this.formatConverseMessages(systemPrompt, messages, baseModelId)

		// Prepare request for Converse API
		const command = new ConverseStreamCommand({
			modelId: modelId,
			messages: formattedResult.messages,
			system: formattedResult.system,
			inferenceConfig: {
				maxTokens: model.info.maxTokens || 5000,
				temperature: 0,
				// topP: 0.9, // Using both temperature and topP as recommended in the docs
			},
		})

		// Execute the streaming request and handle response
		try {
			const response = await client.send(command)

			if (response.stream) {
				let hasReportedInputTokens = false
				let accumulatedTokens = 0
				const TOKEN_REPORT_THRESHOLD = 100 // Report usage after accumulating this many tokens

				for await (const chunk of response.stream) {
					// Handle metadata events with token usage information
					if (chunk.metadata?.usage) {
						// Process usage metadata to extract cache information if available
						const usageData = this.processUsageMetadata(chunk.metadata.usage, model)

						yield {
							type: "usage",
							inputTokens: usageData.inputTokens,
							outputTokens: usageData.outputTokens,
							cacheReadTokens: usageData.cacheReadTokens,
							cacheWriteTokens: usageData.cacheWriteTokens,
							totalCost: usageData.totalCost,
						}

						hasReportedInputTokens = true
						accumulatedTokens = 0 // Reset accumulated tokens after reporting
					}

					// Handle content delta (text generation)
					if (chunk.contentBlockDelta?.delta?.text) {
						const text = chunk.contentBlockDelta.delta.text
						yield {
							type: "text",
							text: text,
						}

						// Estimate token count for reporting
						if (!hasReportedInputTokens) {
							const chunkTokens = this.estimateTokenCount(text)
							accumulatedTokens += chunkTokens

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
					}

					// Handle reasoning content if present
					if (chunk.contentBlockDelta?.delta?.reasoningContent) {
						const reasoning = this.processReasoningContent(chunk.contentBlockDelta.delta.reasoningContent)
						if (reasoning) {
							yield {
								type: "reasoning",
								reasoning: reasoning,
							}
						}
					}

					// Handle errors
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
						yield {
							type: "text",
							text: `[ERROR] Validation error: ${chunk.validationException.message}`,
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
			}
		} catch (error) {
			console.error("Error processing Converse API response:", error)
			yield {
				type: "text",
				text: `[ERROR] Failed to process response: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Formats messages for the Converse API with model-specific adjustments
	 */
	private formatConverseMessages(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		baseModelId: string,
	): {
		messages: { role: ConversationRole; content: any[] }[]
		system?: { text: string }[]
	} {
		// For DeepSeek R1, we need to use the R1 format conversion
		if (baseModelId.includes("deepseek")) {
			// First use convertToR1Format to merge consecutive messages with the same role
			const r1Messages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])

			// Then convert to the format expected by the Converse API
			return {
				messages: r1Messages.map((message) => {
					const role = message.role === "user" ? ConversationRole.USER : ConversationRole.ASSISTANT

					// Process content based on type
					let content: any[] = []

					if (typeof message.content === "string") {
						content = [{ text: message.content }]
					} else if (Array.isArray(message.content)) {
						content = message.content
							.map((item) => {
								if (typeof item === "string") {
									return { text: item }
								}

								if (item.type === "text") {
									return { text: item.text }
								}

								if (item.type === "image_url") {
									// Extract image data from URL
									try {
										const imageUrl = item.image_url.url
										const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/)

										if (match) {
											const format = match[1]
											const base64Data = match[2]
											const imageData = new Uint8Array(Buffer.from(base64Data, "base64"))

											return {
												image: {
													format,
													source: {
														bytes: imageData,
													},
												},
											}
										}
									} catch (error) {
										console.error("Could not convert image data:", error)
									}
								}

								return null
							})
							.filter(Boolean)
					}

					return {
						role,
						content,
					}
				}),
				// For DeepSeek R1, we don't use a separate system message
				system: undefined,
			}
		} else {
			// For Nova and other models, use standard formatting
			return {
				messages: messages.map((message) => {
					const role = message.role === "user" ? ConversationRole.USER : ConversationRole.ASSISTANT

					// Process content based on type
					let content: any[] = []

					if (typeof message.content === "string") {
						// Simple text content
						content = [{ text: message.content }]
					} else if (Array.isArray(message.content)) {
						// Convert Anthropic content format to Nova content format
						content = message.content
							.map((item) => {
								// Text content
								if (item.type === "text") {
									return { text: item.text }
								}

								// Image content
								if (item.type === "image") {
									// Handle image content
									let format = "jpeg" // default format

									// Extract format from media_type if available
									if (item.source.media_type) {
										const formatMatch = item.source.media_type.match(/image\/(\w+)/)
										if (formatMatch && formatMatch[1]) {
											format = formatMatch[1]
											if (!["png", "jpeg", "gif", "webp"].includes(format)) {
												format = "jpeg" // Default to jpeg if not supported
											}
										}
									}

									// Get image data
									try {
										let imageData: Uint8Array

										if (typeof item.source.data === "string") {
											// Handle base64 encoded data
											const base64Data = item.source.data.replace(/^data:image\/\w+;base64,/, "")
											imageData = new Uint8Array(Buffer.from(base64Data, "base64"))
										} else if (item.source.data && typeof item.source.data === "object") {
											// Try to convert to Uint8Array
											imageData = new Uint8Array(Buffer.from(item.source.data as any))
										} else {
											console.error("Unsupported image data format")
											return null // Skip this item if format is not supported
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
										console.error("Could not convert image data:", error)
										return null
									}
								}
								// Return null for unsupported content types
								return null
							})
							.filter(Boolean) // Remove any null items
					}

					// Return formatted message
					return {
						role,
						content,
					}
				}),
				// For Nova models, we use a separate system message
				system: systemPrompt ? [{ text: systemPrompt }] : undefined,
			}
		}
	}

	/**
	 * Process usage metadata to extract cache information if available
	 */
	private processUsageMetadata(
		metadata: any,
		model: { id: string; info: ModelInfo },
	): {
		inputTokens: number
		outputTokens: number
		cacheReadTokens?: number
		cacheWriteTokens?: number
		totalCost: number
	} {
		const inputTokens = metadata.inputTokens || 0
		const outputTokens = metadata.outputTokens || 0

		// Extract cache information if available
		const cacheReadTokens = metadata.cacheReadTokens || metadata.prompt_cache_hit_tokens || 0
		const cacheWriteTokens = metadata.cacheWriteTokens || metadata.prompt_cache_miss_tokens || 0

		// Calculate total cost
		const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

		return {
			inputTokens,
			outputTokens,
			cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
			cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
			totalCost,
		}
	}

	/**
	 * Extract reasoning content from different response formats
	 */
	private processReasoningContent(content: any): string {
		if (!content) {
			return ""
		}

		// Handle different reasoning content formats
		if (typeof content === "string") {
			return content
		}

		if (content.text) {
			return content.text
		}

		if (content.thinking) {
			return content.thinking
		}

		// Try to convert to string if it's an object
		try {
			return JSON.stringify(content)
		} catch (e) {
			return "[Reasoning content in unsupported format]"
		}
	}

	/**
	 * Estimates token count for a text string
	 */
	private estimateTokenCount(text: string): number {
		// Approximate 4 characters per token
		return Math.ceil(text.length / 4)
	}
}
