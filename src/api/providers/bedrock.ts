import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { fromIni } from "@aws-sdk/credential-providers"
import { ApiHandler } from "../"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"

// https://docs.anthropic.com/en/api/claude-on-amazon-bedrock
export class AwsBedrockHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: AnthropicBedrock

	private profile: string

	private initializationPromise: Promise<void>

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.profile = options.awsProfile || "bedrock"
		// Initialize with empty credentials that will be replaced by initializeClient()
		this.client = new AnthropicBedrock({
			awsAccessKey: "",
			awsSecretKey: "",
			awsRegion: this.options.awsRegion || process.env.AWS_REGION || "us-east-1"
		})
		this.initializationPromise = this.initializeClient()
	}

	private async initializeClient() {
		try {
			const credentials = await this._getCredentials()
			this.client = new AnthropicBedrock({
				awsAccessKey: credentials.accessKeyId,
				awsSecretKey: credentials.secretAccessKey,
				...(credentials.sessionToken && { awsSessionToken: credentials.sessionToken }),
				awsRegion: this.options.awsRegion || process.env.AWS_REGION || "us-east-1"
			})
		} catch (error) {
			console.error("Failed to initialize Bedrock client:", error)
			throw error
		}
	}

	private async _getCredentials() {
		try {
			// First try explicit credentials if provided
			if (this.options.awsAccessKey && this.options.awsSecretKey) {
				return {
					accessKeyId: this.options.awsAccessKey,
					secretAccessKey: this.options.awsSecretKey,
					sessionToken: this.options.awsSessionToken
				}
			}

			// Then try loading from specified AWS profile
			return await fromIni({
				profile: this.profile,
				ignoreCache: true
			})()
		} catch (e) {
			console.warn(`AWS profile '${this.profile}' not found in ~/.aws/credentials, using default profile`)
			return await fromIni()()
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Wait for client initialization to complete
		await this.initializationPromise
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
