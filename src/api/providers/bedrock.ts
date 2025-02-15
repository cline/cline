import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { fromIni } from "@aws-sdk/credential-providers"

// https://docs.anthropic.com/en/api/claude-on-amazon-bedrock
export class AwsBedrockHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: AnthropicBedrock | any
	private initializationPromise: Promise<void>

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.initializationPromise = this.initializeClient()
	}

	private async initializeClient() {
		let clientConfig: any = {
			awsRegion: this.options.awsRegion || "us-east-1",
		}
		try {
			if (this.options.awsUseProfile) {
				// Use profile-based credentials if enabled
				// Use named profile, defaulting to 'default' if not specified
				var credentials: any
				if (this.options.awsProfile) {
					credentials = await fromIni({
						profile: this.options.awsProfile,
						ignoreCache: true,
					})()
				} else {
					credentials = await fromIni({
						ignoreCache: true,
					})()
				}
				clientConfig.awsAccessKey = credentials.accessKeyId
				clientConfig.awsSecretKey = credentials.secretAccessKey
				clientConfig.awsSessionToken = credentials.sessionToken
			} else if (this.options.awsAccessKey && this.options.awsSecretKey) {
				// Use direct credentials if provided
				clientConfig.awsAccessKey = this.options.awsAccessKey
				clientConfig.awsSecretKey = this.options.awsSecretKey
				if (this.options.awsSessionToken) {
					clientConfig.awsSessionToken = this.options.awsSessionToken
				}
			}
		} catch (error) {
			console.error("Failed to initialize Bedrock client:", error)
			throw error
		} finally {
			this.client = new AnthropicBedrock(clientConfig)
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// cross region inference requires prefixing the model id with the region
		let modelId: string
		if (this.options.awsUseCrossRegionInference) {
			let regionPrefix = (this.options.awsRegion || "").slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					modelId = `us.${this.getModel().id}`
					break
				case "eu-":
					modelId = `eu.${this.getModel().id}`
					break
				default:
					// cross region inference is not supported in this region, falling back to default model
					modelId = this.getModel().id
					break
			}
		} else {
			modelId = this.getModel().id
		}

		const stream = await this.client.messages.create({
			model: modelId,
			max_tokens: this.getModel().info.maxTokens || 8192,
			temperature: 0,
			system: systemPrompt,
			messages,
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
}
