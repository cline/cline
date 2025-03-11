import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { SingleCompletionHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "../../shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"

const GEMINI_DEFAULT_TEMPERATURE = 0

export class GeminiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: GoogleGenerativeAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = new GoogleGenerativeAI(options.geminiApiKey ?? "not-provided")
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.client.getGenerativeModel(
			{
				model: this.getModel().id,
				systemInstruction: systemPrompt,
			},
			{
				baseUrl: this.options.googleGeminiBaseUrl || undefined,
			},
		)
		const result = await model.generateContentStream({
			contents: messages.map(convertAnthropicMessageToGemini),
			generationConfig: {
				// maxOutputTokens: this.getModel().info.maxTokens,
				temperature: this.options.modelTemperature ?? GEMINI_DEFAULT_TEMPERATURE,
			},
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

	override getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return { id: geminiDefaultModelId, info: geminiModels[geminiDefaultModelId] }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const model = this.client.getGenerativeModel(
				{
					model: this.getModel().id,
				},
				{
					baseUrl: this.options.googleGeminiBaseUrl || undefined,
				},
			)

			const result = await model.generateContent({
				contents: [{ role: "user", parts: [{ text: prompt }] }],
				generationConfig: {
					temperature: this.options.modelTemperature ?? GEMINI_DEFAULT_TEMPERATURE,
				},
			})

			return result.response.text()
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Gemini completion error: ${error.message}`)
			}
			throw error
		}
	}
}
