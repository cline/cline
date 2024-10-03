import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, ApiHandlerMessageResponse } from "../"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"

export class AwsBedrockHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: AnthropicBedrock

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new AnthropicBedrock({
			// Authenticate by either providing the keys below or use the default AWS credential providers, such as
			// using ~/.aws/credentials or the "AWS_SECRET_ACCESS_KEY" and "AWS_ACCESS_KEY_ID" environment variables.
			...(this.options.awsAccessKey ? { awsAccessKey: this.options.awsAccessKey } : {}),
			...(this.options.awsSecretKey ? { awsSecretKey: this.options.awsSecretKey } : {}),
			...(this.options.awsSessionToken ? { awsSessionToken: this.options.awsSessionToken } : {}),

			// awsRegion changes the aws region to which the request is made. By default, we read AWS_REGION,
			// and if that's not present, we default to us-east-1. Note that we do not read ~/.aws/config for the region.
			awsRegion: this.options.awsRegion,
		})
	}

	private getCrossRegionPrefix(): string {
		const region = this.options.awsRegion || "us-east-1"
		return region.startsWith("eu") ? "eu." : "us."
	}

	private getModelId(): BedrockModelId {
		let modelId = (this.options.apiModelId as BedrockModelId) || bedrockDefaultModelId

		if (this.options.awsUseCrossRegionInference) {
			const prefix = this.getCrossRegionPrefix()
			modelId = `${prefix}${modelId}` as BedrockModelId
		}

		return modelId
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<ApiHandlerMessageResponse> {
		const modelId = this.getModelId()
		const { info } = this.getModel()

		const message = await this.client.messages.create({
			model: modelId,
			max_tokens: info.maxTokens,
			temperature: 0.2,
			system: systemPrompt,
			messages,
			tools,
			tool_choice: { type: "auto" },
		})
		return { message }
	}

	getModel(): { id: BedrockModelId; info: ModelInfo } {
		const modelId = this.getModelId()

		if (modelId in bedrockModels) {
			return { id: modelId, info: bedrockModels[modelId] }
		}
		return { id: bedrockDefaultModelId, info: bedrockModels[bedrockDefaultModelId] }
	}
}
