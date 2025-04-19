import type { Anthropic } from "@anthropic-ai/sdk"
// Restore GenerateContentConfig import and add GenerateContentResponseUsageMetadata
import {
	GoogleGenAI,
	type GenerationConfig,
	type Content,
	type GenerateContentConfig,
	type GenerateContentResponseUsageMetadata,
} from "@google/genai"
import { withRetry } from "../retry"
import type { ApiHandler } from "../"
import type { ApiHandlerOptions, GeminiModelId, ModelInfo } from "../../shared/api"
import { geminiDefaultModelId, geminiModels } from "../../shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format" // Note: This converter might need updates for @google/genai format
import type { ApiStream } from "../transform/stream"

export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenAI // Updated client type

	constructor(options: ApiHandlerOptions) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options
		// Updated client initialization
		this.client = new GoogleGenAI({ apiKey: options.geminiApiKey })
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const { id: modelId, info: modelInfo } = this.getModel()

		// Re-implement thinking budget logic based on new SDK structure
		const thinkingBudget = this.options.thinkingBudgetTokens ?? 0
		const maxBudget = modelInfo.thinkingConfig?.maxBudget ?? 0

		// port add baseUrl configuration for gemini api requests (#2843)
		const httpOptions = this.options.geminiBaseUrl ? { baseUrl: this.options.geminiBaseUrl } : undefined

		// Base generation config - Restore type and systemInstruction
		const generationConfig: GenerateContentConfig = {
			httpOptions,
			temperature: 0, // Default temperature
			systemInstruction: systemPrompt, // System prompt belongs here
		}

		// Convert messages to the format expected by @google/genai
		// Note: convertAnthropicMessageToGemini might need adjustments
		const contents: Content[] = messages.map(convertAnthropicMessageToGemini)

		// Construct the main request config - Type as GenerateContentConfig
		const requestConfig: GenerateContentConfig = {
			...generationConfig,
		}

		// Add thinking config if the model supports it
		if (modelInfo.thinkingConfig?.outputPrice !== undefined && maxBudget > 0) {
			requestConfig.thinkingConfig = {
				thinkingBudget: thinkingBudget,
			}
		}

		// Generate content using the new SDK structure via client.models
		const result = await this.client.models.generateContentStream({
			model: modelId, // Pass model ID directly
			// Remove systemInstruction from here
			contents,
			config: requestConfig, // Pass the combined config (which includes systemInstruction)
		})

		// Declare variable to hold the last usage metadata found
		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined

		// Iterate directly over the stream
		for await (const chunk of result) {
			// Access text directly as a property
			if (chunk.text) {
				// Check if text exists
				yield {
					type: "text",
					text: chunk.text, // Access as property
				}
			}
			// Capture usage metadata if present in the chunk
			if (chunk.usageMetadata) {
				lastUsageMetadata = chunk.usageMetadata
			}
		}

		// Yield usage data from the last chunk that contained it
		if (lastUsageMetadata) {
			yield {
				type: "usage",
				inputTokens: lastUsageMetadata.promptTokenCount ?? 0,
				outputTokens: lastUsageMetadata.candidatesTokenCount ?? 0,
			}
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
