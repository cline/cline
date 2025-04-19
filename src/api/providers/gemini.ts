import type { Anthropic } from "@anthropic-ai/sdk"
import {
	GoogleGenAI,
	ThinkingConfig,
	type GenerateContentResponseUsageMetadata,
	type GenerateContentParameters,
} from "@google/genai"

import { SingleCompletionHandler } from "../"
import type { ApiHandlerOptions, GeminiModelId, ModelInfo } from "../../shared/api"
import { geminiDefaultModelId, geminiModels } from "../../shared/api"
import { convertAnthropicContentToGemini, convertAnthropicMessageToGemini } from "../transform/gemini-format"
import type { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"

export class GeminiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: GoogleGenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = new GoogleGenAI({ apiKey: options.geminiApiKey ?? "not-provided" })
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const { id: model, thinkingConfig, maxOutputTokens } = this.getModel()

		const params: GenerateContentParameters = {
			model,
			contents: messages.map(convertAnthropicMessageToGemini),
			config: {
				httpOptions: this.options.googleGeminiBaseUrl
					? { baseUrl: this.options.googleGeminiBaseUrl }
					: undefined,
				thinkingConfig,
				maxOutputTokens,
				temperature: this.options.modelTemperature ?? 0,
				systemInstruction: systemPrompt,
			},
		}

		const result = await this.client.models.generateContentStream(params)

		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined

		for await (const chunk of result) {
			if (chunk.text) {
				yield { type: "text", text: chunk.text }
			}

			if (chunk.usageMetadata) {
				lastUsageMetadata = chunk.usageMetadata
			}
		}

		if (lastUsageMetadata) {
			yield {
				type: "usage",
				inputTokens: lastUsageMetadata.promptTokenCount ?? 0,
				outputTokens: lastUsageMetadata.candidatesTokenCount ?? 0,
			}
		}
	}

	override getModel(): {
		id: GeminiModelId
		info: ModelInfo
		thinkingConfig?: ThinkingConfig
		maxOutputTokens?: number
	} {
		let id = this.options.apiModelId ? (this.options.apiModelId as GeminiModelId) : geminiDefaultModelId
		let info: ModelInfo = geminiModels[id]
		let thinkingConfig: ThinkingConfig | undefined = undefined
		let maxOutputTokens: number | undefined = undefined

		const thinkingSuffix = ":thinking"

		if (id?.endsWith(thinkingSuffix)) {
			id = id.slice(0, -thinkingSuffix.length) as GeminiModelId
			info = geminiModels[id]

			thinkingConfig = this.options.modelMaxThinkingTokens
				? { thinkingBudget: this.options.modelMaxThinkingTokens }
				: undefined

			maxOutputTokens = this.options.modelMaxTokens ?? info.maxTokens ?? undefined
		}

		if (!info) {
			id = geminiDefaultModelId
			info = geminiModels[geminiDefaultModelId]
			thinkingConfig = undefined
			maxOutputTokens = undefined
		}

		return { id, info, thinkingConfig, maxOutputTokens }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const { id: model } = this.getModel()

			const result = await this.client.models.generateContent({
				model,
				contents: [{ role: "user", parts: [{ text: prompt }] }],
				config: {
					httpOptions: this.options.googleGeminiBaseUrl
						? { baseUrl: this.options.googleGeminiBaseUrl }
						: undefined,
					temperature: this.options.modelTemperature ?? 0,
				},
			})

			return result.text ?? ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Gemini completion error: ${error.message}`)
			}

			throw error
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		try {
			const { id: model } = this.getModel()

			const response = await this.client.models.countTokens({
				model,
				contents: convertAnthropicContentToGemini(content),
			})

			if (response.totalTokens === undefined) {
				console.warn("Gemini token counting returned undefined, using fallback")
				return super.countTokens(content)
			}

			return response.totalTokens
		} catch (error) {
			console.warn("Gemini token counting failed, using fallback", error)
			return super.countTokens(content)
		}
	}
}
