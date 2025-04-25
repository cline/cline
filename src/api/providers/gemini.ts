import { Anthropic } from "@anthropic-ai/sdk"
// Correct package for the client class and types
import { GoogleGenerativeAI, Content, GenerationConfig } from "@google/generative-ai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "@shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

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

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Define model options first
		const modelOptions = {
			model: this.getModel().id,
			systemInstruction: systemPrompt, // Pass system prompt here
		}
		const clientOptions = this.options.geminiBaseUrl ? { baseUrl: this.options.geminiBaseUrl } : undefined

		// Use the getGenerativeModel structure - This passed type checks before
		const model = this.client.getGenerativeModel(modelOptions, clientOptions)

		// Prepare contents using the standardized conversion function
		const contents: Content[] = messages.map(convertAnthropicMessageToGemini)

		// Define generationConfig
		const generationConfig: GenerationConfig = {
			temperature: 0,
			// maxOutputTokens: this.getModel().info.maxTokens, // Optional
		}

		// Use model.generateContentStream
		const result = await model.generateContentStream({
			contents,
			generationConfig,
		})

		for await (const chunk of result.stream) {
			yield {
				type: "text",
				text: chunk.text(),
			}
		}

		const response = await result.response
		yield {
			type: "usage",
			inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
			outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
		}
	}

	getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return {
			id: geminiDefaultModelId,
			info: geminiModels[geminiDefaultModelId],
		}
	}
}
