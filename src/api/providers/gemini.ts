import { Anthropic } from "@anthropic-ai/sdk"
import { FunctionCallingMode, GoogleGenerativeAI } from "@google/generative-ai"
import { ApiHandler, ApiHandlerMessageResponse } from "."
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "../shared/api"
import {
	convertAnthropicMessageToGemini,
	convertAnthropicToolToGemini,
	convertGeminiResponseToAnthropic,
} from "./transform/gemini-format"

export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenerativeAI

	constructor(options: ApiHandlerOptions) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options
		this.client = new GoogleGenerativeAI(options.geminiApiKey)
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<ApiHandlerMessageResponse> {
		const model = this.client.getGenerativeModel({
			model: this.getModel().id,
			systemInstruction: systemPrompt,
			tools: [{ functionDeclarations: tools.map(convertAnthropicToolToGemini) }],
			toolConfig: {
				functionCallingConfig: {
					mode: FunctionCallingMode.AUTO,
				},
			},
		})
		const result = await model.generateContent({
			contents: messages.map(convertAnthropicMessageToGemini),
			generationConfig: {
				maxOutputTokens: this.getModel().info.maxTokens,
				temperature: 0.2,
			},
		})
		const message = convertGeminiResponseToAnthropic(result.response)

		return { message }
	}

	getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return { id: geminiDefaultModelId, info: geminiModels[geminiDefaultModelId] }
	}
}
