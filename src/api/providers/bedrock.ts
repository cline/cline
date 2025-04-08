import { Anthropic } from "@anthropic-ai/sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { convertToR1Format } from "../transform/r1-format"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { ApiStream } from "../transform/stream"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import {
	BedrockRuntimeClient,
	ConversationRole,
	ConverseStreamCommand,
	InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime"

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

		// Check if this is an Amazon Nova model
		if (modelId.includes("amazon.nova")) {
			yield* this.createNovaMessage(systemPrompt, messages, modelId, model)
			return
		}

		// Check if this is a Deepseek model
		if (modelId.includes("deepseek")) {
			yield* this.createDeepseekMessage(systemPrompt, messages, modelId, model)
			return
		}

		// For Anthropic models, use the AWS Bedrock Runtime client directly
		yield* this.createAnthropicMessage(systemPrompt, messages, modelId, model)
	}

	/**
	 * Creates a message using Anthropic models through AWS Bedrock
	 */
	private async *createAnthropicMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		model: { id: BedrockModelId; info: ModelInfo },
	): ApiStream {
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()

		// Determine if reasoning should be enabled
		const budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = modelId.includes("3-7") && budget_tokens !== 0 ? true : false

		// Get model info and message indices for caching
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Format the request body for Anthropic models
		const requestBody = {
			anthropic_version: "bedrock-2023-05-31",
			max_tokens: model.info.maxTokens || 8192,
			temperature: reasoningOn ? undefined : 0,
			system: systemPrompt,
			messages: messages.map((message) => {
				// Convert message content to the format expected by Bedrock
				let formattedContent: any[] = []

				if (typeof message.content === "string") {
					formattedContent = [{ type: "text", text: message.content }]
				} else {
					formattedContent = message.content
						.map((item) => {
							if (item.type === "text") {
								return { type: "text", text: item.text }
							} else if (item.type === "image") {
								// Handle image content
								let format = "jpeg"
								if (item.source.media_type) {
									const formatMatch = item.source.media_type.match(/image\/(\w+)/)
									if (formatMatch && formatMatch[1]) {
										format = formatMatch[1]
									}
								}

								let imageData: string
								if (typeof item.source.data === "string") {
									imageData = item.source.data.replace(/^data:image\/\w+;base64,/, "")
								} else {
									// Convert to base64 if needed
									imageData = Buffer.from(item.source.data as any).toString("base64")
								}

								return {
									type: "image",
									source: {
										type: "base64",
										media_type: `image/${format}`,
										data: imageData,
									},
								}
							}
							return null
						})
						.filter(Boolean)
				}

				return {
					role: message.role,
					content: formattedContent,
				}
			}),
			...(reasoningOn && { thinking: { type: "enabled", budget_tokens: budget_tokens } }),
			...(this.options.awsBedrockUsePromptCache === true && { cache_control: { type: "ephemeral" } }),
		}

		// Create the command for streaming
		const command = new InvokeModelWithResponseStreamCommand({
			modelId: modelId,
			contentType: "application/json",
			accept: "application/json",
			body: JSON.stringify(requestBody),
		})

		// Execute the streaming request
		const response = await client.send(command)

		if (response.body) {
			let isFirstChunk = true
			let outputTokens = 0
			let inputTokens = 0
			let cacheReadTokens = 0
			let cacheWriteTokens = 0

			for await (const chunk of response.body) {
				if (chunk.chunk?.bytes) {
					try {
						// Parse the response chunk
						const decodedChunk = new TextDecoder().decode(chunk.chunk.bytes)
						const parsedChunk = JSON.parse(decodedChunk)

						// Handle different types of chunks based on Anthropic's response format
						if (parsedChunk.type === "message_start") {
							// First chunk with usage information
							if (parsedChunk.message && parsedChunk.message.usage) {
								const usage = parsedChunk.message.usage
								inputTokens = usage.input_tokens || 0
								outputTokens = usage.output_tokens || 0
								cacheReadTokens = usage.cache_read_input_tokens || 0
								cacheWriteTokens = usage.cache_creation_input_tokens || 0

								yield {
									type: "usage",
									inputTokens: inputTokens,
									outputTokens: outputTokens,
									cacheReadTokens: cacheReadTokens,
									cacheWriteTokens: cacheWriteTokens,
									totalCost: calculateApiCostOpenAI(
										model.info,
										inputTokens,
										outputTokens,
										cacheWriteTokens,
										cacheReadTokens,
									),
								}
							}
						} else if (parsedChunk.type === "message_delta") {
							// Token usage update
							if (parsedChunk.usage) {
								const deltaOutputTokens = parsedChunk.usage.output_tokens || 0
								outputTokens += deltaOutputTokens

								yield {
									type: "usage",
									inputTokens: 0,
									outputTokens: deltaOutputTokens,
								}
							}
						} else if (parsedChunk.type === "content_block_start") {
							// Content block start
							if (parsedChunk.content_block) {
								const contentBlock = parsedChunk.content_block

								if (contentBlock.type === "thinking") {
									// Reasoning content
									yield {
										type: "reasoning",
										reasoning: contentBlock.thinking || "",
									}
								} else if (contentBlock.type === "redacted_thinking") {
									// Redacted thinking blocks
									yield {
										type: "reasoning",
										reasoning: "[Redacted thinking block]",
									}
								} else if (contentBlock.type === "text") {
									// Text content
									if (parsedChunk.index > 0) {
										yield {
											type: "text",
											text: "\n",
										}
									}
									yield {
										type: "text",
										text: contentBlock.text,
									}
								}
							}
						} else if (parsedChunk.type === "content_block_delta") {
							// Content block delta
							if (parsedChunk.delta) {
								const delta = parsedChunk.delta

								if (delta.type === "thinking_delta") {
									// Reasoning delta
									yield {
										type: "reasoning",
										reasoning: delta.thinking,
									}
								} else if (delta.type === "text_delta") {
									// Text delta
									yield {
										type: "text",
										text: delta.text,
									}
								}
							}
						}
					} catch (error) {
						console.error("Error parsing Anthropic response chunk:", error)
						yield {
							type: "text",
							text: `[ERROR] Failed to parse Anthropic response: ${error instanceof Error ? error.message : String(error)}`,
						}
					}
				}
			}

			// Final usage report
			yield {
				type: "usage",
				inputTokens: inputTokens,
				outputTokens: outputTokens,
				cacheReadTokens: cacheReadTokens,
				cacheWriteTokens: cacheWriteTokens,
				totalCost: calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
			}
		}
	}

	getModel(): { id: BedrockModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bedrockModels) {
			const id = modelId as BedrockModelId
			return { id, info: bedrockModels[id] }
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
				AwsBedrockHandler.setEnv("AWS_ACCESS_KEY_ID", this.options.awsAccessKey)
				AwsBedrockHandler.setEnv("AWS_SECRET_ACCESS_KEY", this.options.awsSecretKey)
				AwsBedrockHandler.setEnv("AWS_SESSION_TOKEN", this.options.awsSessionToken)
				AwsBedrockHandler.setEnv("AWS_PROFILE", this.options.awsProfile)
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
	private async getAnthropicClient(): Promise<BedrockRuntimeClient> {
		return await this.getBedrockClient()
	}

	/**
	 * Gets the appropriate model ID, accounting for cross-region inference if enabled
	 */
	async getModelId(): Promise<string> {
		if (this.options.awsUseCrossRegionInference) {
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
	 * Creates a message using the Deepseek R1 model through AWS Bedrock
	 */
	private async *createDeepseekMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		model: { id: BedrockModelId; info: ModelInfo },
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
	private formatDeepseekR1Prompt(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
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
	private estimateInputTokens(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): number {
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
	 * Creates a message using Amazon Nova models through AWS Bedrock
	 * Implements support for Nova Micro, Nova Lite, and Nova Pro models
	 */
	private async *createNovaMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		model: { id: BedrockModelId; info: ModelInfo },
	): ApiStream {
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()

		// Format messages for Nova model
		const formattedMessages = this.formatNovaMessages(messages)

		// Prepare request for Nova model
		const command = new ConverseStreamCommand({
			modelId: modelId,
			messages: formattedMessages,
			system: systemPrompt ? [{ text: systemPrompt }] : undefined,
			inferenceConfig: {
				maxTokens: model.info.maxTokens || 5000,
				temperature: 0,
				// topP: 0.9, // Alternative: use topP instead of temperature
			},
		})

		// Execute the streaming request and handle response
		try {
			const response = await client.send(command)

			if (response.stream) {
				let hasReportedInputTokens = false

				for await (const chunk of response.stream) {
					// Handle metadata events with token usage information
					if (chunk.metadata?.usage) {
						// Report complete token usage from the model itself
						const inputTokens = chunk.metadata.usage.inputTokens || 0
						const outputTokens = chunk.metadata.usage.outputTokens || 0
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
							totalCost: calculateApiCostOpenAI(model.info, inputTokens, outputTokens, 0, 0),
						}
						hasReportedInputTokens = true
					}

					// Handle content delta (text generation)
					if (chunk.contentBlockDelta?.delta?.text) {
						yield {
							type: "text",
							text: chunk.contentBlockDelta.delta.text,
						}
					}

					// Handle reasoning content if present
					if (chunk.contentBlockDelta?.delta?.reasoningContent?.text) {
						yield {
							type: "reasoning",
							reasoning: chunk.contentBlockDelta.delta.reasoningContent.text,
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
			}
		} catch (error) {
			console.error("Error processing Nova model response:", error)
			yield {
				type: "text",
				text: `[ERROR] Failed to process Nova response: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Formats messages for Amazon Nova models according to the SDK specification
	 */
	private formatNovaMessages(messages: Anthropic.Messages.MessageParam[]): { role: ConversationRole; content: any[] }[] {
		return messages.map((message) => {
			// Determine role (user or assistant)
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
							// Handle different image source formats
							let imageData: Uint8Array
							let format = "jpeg" // default format

							// Extract format from media_type if available
							if (item.source.media_type) {
								// Extract format from media_type (e.g., "image/jpeg" -> "jpeg")
								const formatMatch = item.source.media_type.match(/image\/(\w+)/)
								if (formatMatch && formatMatch[1]) {
									format = formatMatch[1]
									// Ensure format is one of the allowed values
									if (!["png", "jpeg", "gif", "webp"].includes(format)) {
										format = "jpeg" // Default to jpeg if not supported
									}
								}
							}

							// Get image data
							try {
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
							} catch (error) {
								console.error("Could not convert image data to Uint8Array:", error)
								return null // Skip this item if conversion fails
							}

							return {
								image: {
									format,
									source: {
										bytes: imageData,
									},
								},
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
		})
	}
}
