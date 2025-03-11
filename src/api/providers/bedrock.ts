import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime"
import { convertToR1Format } from "../transform/r1-format"

// https://docs.anthropic.com/en/api/claude-on-amazon-bedrock
export class AwsBedrockHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// cross region inference requires prefixing the model id with the region
		let modelId = await this.getModelId()
		const model = this.getModel()

		// Check if this is a Deepseek model
		if (modelId.includes("deepseek")) {
			yield* this.createDeepseekMessage(systemPrompt, messages, modelId, model)
			return
		}

		let budget_tokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = modelId.includes("3-7") && budget_tokens !== 0 ? true : false

		// Get model info and message indices for caching
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Create anthropic client, using sessions created or renewed after this handler's
		// initialization, and allowing for session renewal if necessary as well
		const client = await this.getAnthropicClient()

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
		})
	}

	/**
	 * Gets the appropriate model ID, accounting for cross-region inference if enabled
	 */
	async getModelId(): Promise<string> {
		if (this.options.awsUseCrossRegionInference) {
			let regionPrefix = this.getRegion().slice(0, 3)
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
	 * Creates a message using the Deepseek model through AWS Bedrock
	 */
	private async *createDeepseekMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		model: { id: BedrockModelId; info: ModelInfo },
	): ApiStream {
		// Get Bedrock client with proper credentials
		const client = await this.getBedrockClient()

		// Format messages for Deepseek
		const formattedMessages = this.formatDeepseekMessages(systemPrompt, messages)

		// Prepare the request
		const command = new InvokeModelWithResponseStreamCommand({
			modelId: modelId,
			contentType: "application/json",
			accept: "application/json",
			body: JSON.stringify({
				messages: formattedMessages,
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
							yield {
								type: "usage",
								inputTokens: inputTokenEstimate,
								outputTokens: 0,
							}
						}

						// Extract text content from the response
						if (parsedChunk.delta?.text) {
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
								yield {
									type: "usage",
									inputTokens: 0,
									outputTokens: accumulatedTokens,
								}
								accumulatedTokens = 0
							}
						} else if (parsedChunk.delta?.content) {
							const text = parsedChunk.delta.content
							const chunkTokens = this.estimateTokenCount(text)
							outputTokens += chunkTokens
							accumulatedTokens += chunkTokens

							yield {
								type: "text",
								text: text,
							}

							// Report aggregated token usage only when threshold is reached
							if (accumulatedTokens >= TOKEN_REPORT_THRESHOLD) {
								yield {
									type: "usage",
									inputTokens: 0,
									outputTokens: accumulatedTokens,
								}
								accumulatedTokens = 0
							}
						}
					} catch (error) {
						console.error("Error parsing Deepseek response chunk:", error)
					}
				}
			}

			// Report any remaining accumulated tokens at the end of the stream
			if (accumulatedTokens > 0) {
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: accumulatedTokens,
				}
			}
		}
	}

	/**
	 * Formats messages for the Deepseek model
	 */
	private formatDeepseekMessages(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]) {
		// Start with system message if provided
		const messagesWithSystem = systemPrompt ? [{ role: "user" as const, content: systemPrompt }, ...messages] : messages

		// Use the r1-format utility to format messages correctly
		return convertToR1Format(messagesWithSystem)
	}

	/**
	 * Estimates token count based on text length (approximate)
	 * Note: This is a rough estimation, as the actual token count depends on the tokenizer
	 */
	private estimateInputTokens(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): number {
		const systemTokens = systemPrompt.length / 4

		const messageTokens = messages.reduce((total, message) => {
			if (typeof message.content === "string") {
				return total + message.content.length / 4
			} else {
				const textContent = message.content
					.filter((item) => item.type === "text")
					.map((item) => item.text)
					.join(" ")
				return total + textContent.length / 4
			}
		}, 0)

		return Math.ceil(systemTokens + messageTokens)
	}

	/**
	 * Estimates token count for a text string
	 */
	private estimateTokenCount(text: string): number {
		// Approximate 4 characters per token
		return Math.ceil(text.length / 4)
	}
}
