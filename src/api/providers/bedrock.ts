import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { fromIni, fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { ClaudeStreamingHandler } from "./claude-streaming"

/**
 * Handles interactions with the Anthropic Bedrock service using AWS credentials.
 */
export class AwsBedrockHandler extends ClaudeStreamingHandler<AnthropicBedrock> {
	async getClient() {
		const clientConfig: any = {
			awsRegion: this.options.awsRegion || "us-west-2",
		}

		try {
			this.saveClientToNodeProviderChain()
			// Use AWS profile credentials if specified.
			if (this.options.awsUseProfile) {
				const credentials = await fromIni({
					profile: this.options.awsProfile || "default",
					ignoreCache: true,
				})()
				clientConfig.awsAccessKey = credentials.accessKeyId
				clientConfig.awsSecretKey = credentials.secretAccessKey
				clientConfig.awsSessionToken = credentials.sessionToken
			}
			// Use provided AWS access key and secret key if specified.
			else if (this.options.awsAccessKey && this.options.awsSecretKey) {
				clientConfig.awsAccessKey = this.options.awsAccessKey
				clientConfig.awsSecretKey = this.options.awsSecretKey
				if (this.options.awsSessionToken) {
					clientConfig.awsSessionToken = this.options.awsSessionToken
				}
			}
		} catch (error) {
			console.error("Failed to initialize Bedrock client:", error)
			throw error
		}
		return new AnthropicBedrock(clientConfig)
	}

	async *createStreamingMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = this.getModelId()

		let stream: AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>

		if (Object.keys(bedrockModels).includes(modelId)) {
			stream = await this.createModelStream(
				systemPrompt,
				messages,
				modelId,
				model.info.maxTokens ?? ClaudeStreamingHandler.DEFAULT_TOKEN_SIZE,
			)
		} else {
			stream = await this.client.messages.create({
				model: modelId,
				max_tokens: model.info.maxTokens || ClaudeStreamingHandler.DEFAULT_TOKEN_SIZE,
				temperature: ClaudeStreamingHandler.DEFAULT_TEMPERATURE,
				system: systemPrompt,
				messages,
				stream: true,
			})
		}

		yield* this.processStream(stream)
	}

	async createModelStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		maxTokens: number,
	): Promise<AnthropicStream<Anthropic.Messages.RawMessageStreamEvent>> {
		const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])

		return await this.client.messages.create({
			model: modelId,
			max_tokens: maxTokens || ClaudeStreamingHandler.DEFAULT_TOKEN_SIZE,
			temperature: ClaudeStreamingHandler.DEFAULT_TEMPERATURE,
			system: [
				{
					text: systemPrompt,
					type: "text",
					cache_control: { type: "ephemeral" },
				},
			], // setting cache breakpoint for system prompt so new tasks can reuse it
			messages,
			stream: true,
		})
	}

	protected getModelId(): string {
		if (this.options.awsUseCrossRegionInference) {
			const regionPrefix = (this.options.awsRegion || "").slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					return `us.${this.getModel().id}`
				case "eu-":
					return `eu.${this.getModel().id}`
				default:
					return this.getModel().id
			}
		}
		return this.getModel().id
	}

	getModel(): { id: BedrockModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bedrockModels) {
			// Return the model information for the specified model ID
			return { id: modelId as BedrockModelId, info: bedrockModels[modelId as BedrockModelId] }
		}
		return { id: bedrockDefaultModelId, info: bedrockModels[bedrockDefaultModelId] }
	}

	private async saveClientToNodeProviderChain() {
		// Create AWS credentials by executing a an AWS provider chain exactly as the
		// Anthropic SDK does it, by wrapping the default chain into a temporary process
		// environment.
		const providerChain = fromNodeProviderChain()
		await AwsBedrockHandler.withTempEnv(
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

	private static async withTempEnv<R>(updateEnv: () => void, fn: () => Promise<R>): Promise<R> {
		const previousEnv = { ...process.env }

		try {
			updateEnv()
			return await fn()
		} finally {
			process.env = previousEnv
		}
	}

	private static async setEnv(key: string, value: string | undefined) {
		if (key !== "" && value !== undefined) {
			process.env[key] = value
		}
	}
}
