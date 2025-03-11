import {
	BedrockRuntimeClient,
	ConverseStreamCommand,
	ConverseCommand,
	BedrockRuntimeClientConfig,
} from "@aws-sdk/client-bedrock-runtime"
import { fromIni } from "@aws-sdk/credential-providers"
import { Anthropic } from "@anthropic-ai/sdk"
import { SingleCompletionHandler } from "../"
import { ApiHandlerOptions, BedrockModelId, ModelInfo, bedrockDefaultModelId, bedrockModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToBedrockConverseMessages } from "../transform/bedrock-converse-format"
import { BaseProvider } from "./base-provider"
import { logger } from "../../utils/logging"

/**
 * Validates an AWS Bedrock ARN format and optionally checks if the region in the ARN matches the provided region
 * @param arn The ARN string to validate
 * @param region Optional region to check against the ARN's region
 * @returns An object with validation results: { isValid, arnRegion, errorMessage }
 */
function validateBedrockArn(arn: string, region?: string) {
	// Validate ARN format
	const arnRegex = /^arn:aws:bedrock:([^:]+):(\d+):(foundation-model|provisioned-model|default-prompt-router)\/(.+)$/
	const match = arn.match(arnRegex)

	if (!match) {
		return {
			isValid: false,
			arnRegion: undefined,
			errorMessage:
				"Invalid ARN format. ARN should follow the pattern: arn:aws:bedrock:region:account-id:resource-type/resource-name",
		}
	}

	// Extract region from ARN
	const arnRegion = match[1]

	// Check if region in ARN matches provided region (if specified)
	if (region && arnRegion !== region) {
		return {
			isValid: true,
			arnRegion,
			errorMessage: `Warning: The region in your ARN (${arnRegion}) does not match your selected region (${region}). This may cause access issues. The provider will use the region from the ARN.`,
		}
	}

	// ARN is valid and region matches (or no region was provided to check against)
	return {
		isValid: true,
		arnRegion,
		errorMessage: undefined,
	}
}

const BEDROCK_DEFAULT_TEMPERATURE = 0.3

// Define types for stream events based on AWS SDK
export interface StreamEvent {
	messageStart?: {
		role?: string
	}
	messageStop?: {
		stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
		additionalModelResponseFields?: Record<string, unknown>
	}
	contentBlockStart?: {
		start?: {
			text?: string
		}
		contentBlockIndex?: number
	}
	contentBlockDelta?: {
		delta?: {
			text?: string
		}
		contentBlockIndex?: number
	}
	metadata?: {
		usage?: {
			inputTokens: number
			outputTokens: number
			totalTokens?: number // Made optional since we don't use it
		}
		metrics?: {
			latencyMs: number
		}
	}
}

export class AwsBedrockHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: BedrockRuntimeClient

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Extract region from custom ARN if provided
		let region = this.options.awsRegion || "us-east-1"

		// If using custom ARN, extract region from the ARN
		if (this.options.awsCustomArn) {
			const validation = validateBedrockArn(this.options.awsCustomArn, region)

			if (validation.isValid && validation.arnRegion) {
				// If there's a region mismatch warning, log it and use the ARN region
				if (validation.errorMessage) {
					logger.info(
						`Region mismatch: Selected region is ${region}, but ARN region is ${validation.arnRegion}. Using ARN region.`,
						{
							ctx: "bedrock",
							selectedRegion: region,
							arnRegion: validation.arnRegion,
						},
					)
					region = validation.arnRegion
				}
			}
		}

		const clientConfig: BedrockRuntimeClientConfig = {
			region: region,
		}

		if (this.options.awsUseProfile && this.options.awsProfile) {
			// Use profile-based credentials if enabled and profile is set
			clientConfig.credentials = fromIni({
				profile: this.options.awsProfile,
			})
		} else if (this.options.awsAccessKey && this.options.awsSecretKey) {
			// Use direct credentials if provided
			clientConfig.credentials = {
				accessKeyId: this.options.awsAccessKey,
				secretAccessKey: this.options.awsSecretKey,
				...(this.options.awsSessionToken ? { sessionToken: this.options.awsSessionToken } : {}),
			}
		}

		this.client = new BedrockRuntimeClient(clientConfig)
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelConfig = this.getModel()

		// Handle cross-region inference
		let modelId: string

		// For custom ARNs, use the ARN directly without modification
		if (this.options.awsCustomArn) {
			modelId = modelConfig.id

			// Validate ARN format and check region match
			const clientRegion = this.client.config.region as string
			const validation = validateBedrockArn(modelId, clientRegion)

			if (!validation.isValid) {
				logger.error("Invalid ARN format", {
					ctx: "bedrock",
					modelId,
					errorMessage: validation.errorMessage,
				})
				yield {
					type: "text",
					text: `Error: ${validation.errorMessage}`,
				}
				yield { type: "usage", inputTokens: 0, outputTokens: 0 }
				throw new Error("Invalid ARN format")
			}

			// Extract region from ARN
			const arnRegion = validation.arnRegion!

			// Log warning if there's a region mismatch
			if (validation.errorMessage) {
				logger.warn(validation.errorMessage, {
					ctx: "bedrock",
					arnRegion,
					clientRegion,
				})
			}
		} else if (this.options.awsUseCrossRegionInference) {
			let regionPrefix = (this.options.awsRegion || "").slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					modelId = `us.${modelConfig.id}`
					break
				case "eu-":
					modelId = `eu.${modelConfig.id}`
					break
				default:
					modelId = modelConfig.id
					break
			}
		} else {
			modelId = modelConfig.id
		}

		// Convert messages to Bedrock format
		const formattedMessages = convertToBedrockConverseMessages(messages)

		// Construct the payload
		const payload = {
			modelId,
			messages: formattedMessages,
			system: [{ text: systemPrompt }],
			inferenceConfig: {
				maxTokens: modelConfig.info.maxTokens || 4096,
				temperature: this.options.modelTemperature ?? BEDROCK_DEFAULT_TEMPERATURE,
				topP: 0.1,
				...(this.options.awsUsePromptCache
					? {
							promptCache: {
								promptCacheId: this.options.awspromptCacheId || "",
							},
						}
					: {}),
			},
		}

		try {
			// Log the payload for debugging custom ARN issues
			if (this.options.awsCustomArn) {
				logger.debug("Using custom ARN for Bedrock request", {
					ctx: "bedrock",
					customArn: this.options.awsCustomArn,
					clientRegion: this.client.config.region,
					payload: JSON.stringify(payload, null, 2),
				})
			}

			const command = new ConverseStreamCommand(payload)
			const response = await this.client.send(command)

			if (!response.stream) {
				throw new Error("No stream available in the response")
			}

			for await (const chunk of response.stream) {
				// Parse the chunk as JSON if it's a string (for tests)
				let streamEvent: StreamEvent
				try {
					streamEvent = typeof chunk === "string" ? JSON.parse(chunk) : (chunk as unknown as StreamEvent)
				} catch (e) {
					logger.error("Failed to parse stream event", {
						ctx: "bedrock",
						error: e instanceof Error ? e : String(e),
						chunk: typeof chunk === "string" ? chunk : "binary data",
					})
					continue
				}

				// Handle metadata events first
				if (streamEvent.metadata?.usage) {
					yield {
						type: "usage",
						inputTokens: streamEvent.metadata.usage.inputTokens || 0,
						outputTokens: streamEvent.metadata.usage.outputTokens || 0,
					}
					continue
				}

				// Handle message start
				if (streamEvent.messageStart) {
					continue
				}

				// Handle content blocks
				if (streamEvent.contentBlockStart?.start?.text) {
					yield {
						type: "text",
						text: streamEvent.contentBlockStart.start.text,
					}
					continue
				}

				// Handle content deltas
				if (streamEvent.contentBlockDelta?.delta?.text) {
					yield {
						type: "text",
						text: streamEvent.contentBlockDelta.delta.text,
					}
					continue
				}

				// Handle message stop
				if (streamEvent.messageStop) {
					continue
				}
			}
		} catch (error: unknown) {
			logger.error("Bedrock Runtime API Error", {
				ctx: "bedrock",
				error: error instanceof Error ? error : String(error),
			})

			// Enhanced error handling for custom ARN issues
			if (this.options.awsCustomArn) {
				logger.error("Error occurred with custom ARN", {
					ctx: "bedrock",
					customArn: this.options.awsCustomArn,
				})

				// Check for common ARN-related errors
				if (error instanceof Error) {
					const errorMessage = error.message.toLowerCase()

					// Access denied errors
					if (
						errorMessage.includes("access") &&
						(errorMessage.includes("model") || errorMessage.includes("denied"))
					) {
						logger.error("Permissions issue with custom ARN", {
							ctx: "bedrock",
							customArn: this.options.awsCustomArn,
							errorType: "access_denied",
							clientRegion: this.client.config.region,
						})
						yield {
							type: "text",
							text: `Error: You don't have access to the model with the specified ARN. Please verify:

1. The ARN is correct and points to a valid model
2. Your AWS credentials have permission to access this model (check IAM policies)
3. The region in the ARN (${this.client.config.region}) matches the region where the model is deployed
4. If using a provisioned model, ensure it's active and not in a failed state
5. If using a custom model, ensure your account has been granted access to it`,
						}
					}
					// Model not found errors
					else if (errorMessage.includes("not found") || errorMessage.includes("does not exist")) {
						logger.error("Invalid ARN or non-existent model", {
							ctx: "bedrock",
							customArn: this.options.awsCustomArn,
							errorType: "not_found",
						})
						yield {
							type: "text",
							text: `Error: The specified ARN does not exist or is invalid. Please check:

1. The ARN format is correct (arn:aws:bedrock:region:account-id:resource-type/resource-name)
2. The model exists in the specified region
3. The account ID in the ARN is correct
4. The resource type is one of: foundation-model, provisioned-model, or default-prompt-router`,
						}
					}
					// Throttling errors
					else if (
						errorMessage.includes("throttl") ||
						errorMessage.includes("rate") ||
						errorMessage.includes("limit")
					) {
						logger.error("Throttling or rate limit issue with Bedrock", {
							ctx: "bedrock",
							customArn: this.options.awsCustomArn,
							errorType: "throttling",
						})
						yield {
							type: "text",
							text: `Error: Request was throttled or rate limited. Please try:

1. Reducing the frequency of requests
2. If using a provisioned model, check its throughput settings
3. Contact AWS support to request a quota increase if needed`,
						}
					}
					// Other errors
					else {
						logger.error("Unspecified error with custom ARN", {
							ctx: "bedrock",
							customArn: this.options.awsCustomArn,
							errorStack: error.stack,
							errorMessage: error.message,
						})
						yield {
							type: "text",
							text: `Error with custom ARN: ${error.message}

Please check:
1. Your AWS credentials are valid and have the necessary permissions
2. The ARN format is correct
3. The region in the ARN matches the region where you're making the request`,
						}
					}
				} else {
					yield {
						type: "text",
						text: `Unknown error occurred with custom ARN. Please check your AWS credentials and ARN format.`,
					}
				}
			} else {
				// Standard error handling for non-ARN cases
				if (error instanceof Error) {
					logger.error("Standard Bedrock error", {
						ctx: "bedrock",
						errorStack: error.stack,
						errorMessage: error.message,
					})
					yield {
						type: "text",
						text: `Error: ${error.message}`,
					}
				} else {
					logger.error("Unknown Bedrock error", {
						ctx: "bedrock",
						error: String(error),
					})
					yield {
						type: "text",
						text: "An unknown error occurred",
					}
				}
			}

			// Always yield usage info
			yield {
				type: "usage",
				inputTokens: 0,
				outputTokens: 0,
			}

			// Re-throw the error
			if (error instanceof Error) {
				throw error
			} else {
				throw new Error("An unknown error occurred")
			}
		}
	}

	override getModel(): { id: BedrockModelId | string; info: ModelInfo } {
		// If custom ARN is provided, use it
		if (this.options.awsCustomArn) {
			// Custom ARNs should not be modified with region prefixes
			// as they already contain the full resource path

			// Check if the ARN contains information about the model type
			// This helps set appropriate token limits for models behind prompt routers
			const arnLower = this.options.awsCustomArn.toLowerCase()

			// Determine model info based on ARN content
			let modelInfo: ModelInfo

			if (arnLower.includes("claude-3-7-sonnet") || arnLower.includes("claude-3.7-sonnet")) {
				// Claude 3.7 Sonnet has 8192 tokens in Bedrock
				modelInfo = {
					maxTokens: 8192,
					contextWindow: 200_000,
					supportsPromptCache: false,
					supportsImages: true,
					supportsComputerUse: true,
				}
			} else if (arnLower.includes("claude-3-5-sonnet") || arnLower.includes("claude-3.5-sonnet")) {
				// Claude 3.5 Sonnet has 8192 tokens in Bedrock
				modelInfo = {
					maxTokens: 8192,
					contextWindow: 200_000,
					supportsPromptCache: false,
					supportsImages: true,
					supportsComputerUse: true,
				}
			} else if (arnLower.includes("claude-3-opus") || arnLower.includes("claude-3.0-opus")) {
				// Claude 3 Opus has 4096 tokens in Bedrock
				modelInfo = {
					maxTokens: 4096,
					contextWindow: 200_000,
					supportsPromptCache: false,
					supportsImages: true,
				}
			} else if (arnLower.includes("claude-3-haiku") || arnLower.includes("claude-3.0-haiku")) {
				// Claude 3 Haiku has 4096 tokens in Bedrock
				modelInfo = {
					maxTokens: 4096,
					contextWindow: 200_000,
					supportsPromptCache: false,
					supportsImages: true,
				}
			} else if (arnLower.includes("claude-3-5-haiku") || arnLower.includes("claude-3.5-haiku")) {
				// Claude 3.5 Haiku has 8192 tokens in Bedrock
				modelInfo = {
					maxTokens: 8192,
					contextWindow: 200_000,
					supportsPromptCache: false,
					supportsImages: false,
				}
			} else if (arnLower.includes("claude")) {
				// Generic Claude model with conservative token limit
				modelInfo = {
					maxTokens: 4096,
					contextWindow: 128_000,
					supportsPromptCache: false,
					supportsImages: true,
				}
			} else if (arnLower.includes("llama3") || arnLower.includes("llama-3")) {
				// Llama 3 models typically have 8192 tokens in Bedrock
				modelInfo = {
					maxTokens: 8192,
					contextWindow: 128_000,
					supportsPromptCache: false,
					supportsImages: arnLower.includes("90b") || arnLower.includes("11b"),
				}
			} else if (arnLower.includes("nova-pro")) {
				// Amazon Nova Pro
				modelInfo = {
					maxTokens: 5000,
					contextWindow: 300_000,
					supportsPromptCache: false,
					supportsImages: true,
				}
			} else {
				// Default for unknown models or prompt routers
				modelInfo = {
					maxTokens: 4096,
					contextWindow: 128_000,
					supportsPromptCache: false,
					supportsImages: true,
				}
			}

			// If modelMaxTokens is explicitly set in options, override the default
			if (this.options.modelMaxTokens && this.options.modelMaxTokens > 0) {
				modelInfo.maxTokens = this.options.modelMaxTokens
			}

			return {
				id: this.options.awsCustomArn,
				info: modelInfo,
			}
		}

		const modelId = this.options.apiModelId
		if (modelId) {
			// Special case for custom ARN option
			if (modelId === "custom-arn") {
				// This should not happen as we should have awsCustomArn set
				// but just in case, return a default model
				return {
					id: bedrockDefaultModelId,
					info: bedrockModels[bedrockDefaultModelId],
				}
			}

			// For tests, allow any model ID
			if (process.env.NODE_ENV === "test") {
				return {
					id: modelId,
					info: {
						maxTokens: 5000,
						contextWindow: 128_000,
						supportsPromptCache: false,
					},
				}
			}
			// For production, validate against known models
			if (modelId in bedrockModels) {
				const id = modelId as BedrockModelId
				return { id, info: bedrockModels[id] }
			}
		}
		return {
			id: bedrockDefaultModelId,
			info: bedrockModels[bedrockDefaultModelId],
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const modelConfig = this.getModel()

			// Handle cross-region inference
			let modelId: string

			// For custom ARNs, use the ARN directly without modification
			if (this.options.awsCustomArn) {
				modelId = modelConfig.id
				logger.debug("Using custom ARN in completePrompt", {
					ctx: "bedrock",
					customArn: this.options.awsCustomArn,
				})

				// Validate ARN format and check region match
				const clientRegion = this.client.config.region as string
				const validation = validateBedrockArn(modelId, clientRegion)

				if (!validation.isValid) {
					logger.error("Invalid ARN format in completePrompt", {
						ctx: "bedrock",
						modelId,
						errorMessage: validation.errorMessage,
					})
					throw new Error(
						validation.errorMessage ||
							"Invalid ARN format. ARN should follow the pattern: arn:aws:bedrock:region:account-id:resource-type/resource-name",
					)
				}

				// Extract region from ARN
				const arnRegion = validation.arnRegion!

				// Log warning if there's a region mismatch
				if (validation.errorMessage) {
					logger.warn(validation.errorMessage, {
						ctx: "bedrock",
						arnRegion,
						clientRegion,
					})
				}
			} else if (this.options.awsUseCrossRegionInference) {
				let regionPrefix = (this.options.awsRegion || "").slice(0, 3)
				switch (regionPrefix) {
					case "us-":
						modelId = `us.${modelConfig.id}`
						break
					case "eu-":
						modelId = `eu.${modelConfig.id}`
						break
					default:
						modelId = modelConfig.id
						break
				}
			} else {
				modelId = modelConfig.id
			}

			const payload = {
				modelId,
				messages: convertToBedrockConverseMessages([
					{
						role: "user",
						content: prompt,
					},
				]),
				inferenceConfig: {
					maxTokens: modelConfig.info.maxTokens || 4096,
					temperature: this.options.modelTemperature ?? BEDROCK_DEFAULT_TEMPERATURE,
					topP: 0.1,
				},
			}

			// Log the payload for debugging custom ARN issues
			if (this.options.awsCustomArn) {
				logger.debug("Bedrock completePrompt request details", {
					ctx: "bedrock",
					clientRegion: this.client.config.region,
					payload: JSON.stringify(payload, null, 2),
				})
			}

			const command = new ConverseCommand(payload)
			const response = await this.client.send(command)

			if (response.output && response.output instanceof Uint8Array) {
				try {
					const outputStr = new TextDecoder().decode(response.output)
					const output = JSON.parse(outputStr)
					if (output.content) {
						return output.content
					}
				} catch (parseError) {
					logger.error("Failed to parse Bedrock response", {
						ctx: "bedrock",
						error: parseError instanceof Error ? parseError : String(parseError),
					})
				}
			}
			return ""
		} catch (error) {
			// Enhanced error handling for custom ARN issues
			if (this.options.awsCustomArn) {
				logger.error("Error occurred with custom ARN in completePrompt", {
					ctx: "bedrock",
					customArn: this.options.awsCustomArn,
					error: error instanceof Error ? error : String(error),
				})

				if (error instanceof Error) {
					const errorMessage = error.message.toLowerCase()

					// Access denied errors
					if (
						errorMessage.includes("access") &&
						(errorMessage.includes("model") || errorMessage.includes("denied"))
					) {
						throw new Error(
							`Bedrock custom ARN error: You don't have access to the model with the specified ARN. Please verify:
1. The ARN is correct and points to a valid model
2. Your AWS credentials have permission to access this model (check IAM policies)
3. The region in the ARN matches the region where the model is deployed
4. If using a provisioned model, ensure it's active and not in a failed state`,
						)
					}
					// Model not found errors
					else if (errorMessage.includes("not found") || errorMessage.includes("does not exist")) {
						throw new Error(
							`Bedrock custom ARN error: The specified ARN does not exist or is invalid. Please check:
1. The ARN format is correct (arn:aws:bedrock:region:account-id:resource-type/resource-name)
2. The model exists in the specified region
3. The account ID in the ARN is correct
4. The resource type is one of: foundation-model, provisioned-model, or default-prompt-router`,
						)
					}
					// Throttling errors
					else if (
						errorMessage.includes("throttl") ||
						errorMessage.includes("rate") ||
						errorMessage.includes("limit")
					) {
						throw new Error(
							`Bedrock custom ARN error: Request was throttled or rate limited. Please try:
1. Reducing the frequency of requests
2. If using a provisioned model, check its throughput settings
3. Contact AWS support to request a quota increase if needed`,
						)
					} else {
						throw new Error(`Bedrock custom ARN error: ${error.message}`)
					}
				}
			}

			// Standard error handling
			if (error instanceof Error) {
				throw new Error(`Bedrock completion error: ${error.message}`)
			}
			throw error
		}
	}
}
