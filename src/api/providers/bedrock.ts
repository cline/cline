import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { fromIni } from "@aws-sdk/credential-providers"
import { EnterpriseHandler } from "./enterprise"

/**
 * Handles interactions with the Anthropic Bedrock service using AWS credentials.
 */
export class AwsBedrockHandler extends EnterpriseHandler {
	/**
	 * Initializes the AnthropicBedrock client with AWS credentials.
	 * @returns A promise that resolves when the client is initialized.
	 */
	async initialize() {
		const clientConfig: any = {
			awsRegion: this.options.awsRegion || "us-east-1",
		}

		try {
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
		} finally {
			return new AnthropicBedrock(clientConfig)
		}
	}

	/**
	 * Creates a message stream to the Anthropic Bedrock service.
	 * @param systemPrompt - The system prompt to initialize the conversation.
	 * @param messages - An array of message parameters.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	async *createEnterpriseMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.getModelId()
		const stream = await this.client.messages.create({
			model: modelId,
			max_tokens: this.getModel().info.maxTokens || 8192,
			temperature: 0,
			system: systemPrompt,
			messages,
			stream: true,
		})

		return this.processStream(stream)
	}

	/**
	 * Processes each chunk of the stream and yields the appropriate ApiStream events.
	 * @param chunk - The chunk of data received from the stream.
	 * @returns An asynchronous generator yielding ApiStream events.
	 */
	async *processChunk(chunk: any): ApiStream {
		switch (chunk.type) {
			case "message_start":
				yield {
					type: "usage",
					inputTokens: chunk.message.usage.input_tokens || 0,
					outputTokens: chunk.message.usage.output_tokens || 0,
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
				if (chunk.content_block.type === "text") {
					if (chunk.index > 0) {
						yield { type: "text", text: "\n" }
					}
					yield { type: "text", text: chunk.content_block.text }
				}
				break
			case "content_block_delta":
				if (chunk.delta.type === "text_delta") {
					yield { type: "text", text: chunk.delta.text }
				}
				break
		}
	}

	/**
	 * Determines the model ID to use, considering cross-region inference if specified.
	 * @returns A string representing the model ID.
	 */
	private getModelId(): string {
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

	/**
	 * Retrieves the model information based on the provided or default model ID.
	 * @returns An object containing the model ID and model information.
	 */
	getModel(): { id: BedrockModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bedrockModels) {
			// Return the model information for the specified model ID
			return { id: modelId as BedrockModelId, info: bedrockModels[modelId as BedrockModelId] }
		}
		return { id: bedrockDefaultModelId, info: bedrockModels[bedrockDefaultModelId] }
	}
}
