import { Anthropic } from "@anthropic-ai/sdk"
// Standardize on @google/generative-ai for client and types
import { GoogleGenerativeAI, Content, GenerationConfig } from "@google/generative-ai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
// Keep Vertex-specific models/types for getModel()
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "@shared/api"
import { ApiStream } from "@api/transform/stream"
import { calculateApiCostOpenAI } from "@utils/cost"
// Use the standardized conversion function from @google/generative-ai types
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"

// This handler now uses the @google/generative-ai SDK to interact with Vertex AI endpoints
// that support the Google Generative AI API format.
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions
	// Use the standard GoogleGenerativeAI client
	private client: GoogleGenerativeAI

	constructor(options: ApiHandlerOptions) {
		// Ensure API key is provided for authentication with @google/generative-ai client
		if (!options.geminiApiKey) {
			// Assuming the API key for @google/generative-ai works for Vertex endpoints
			// This might need adjustment based on actual Vertex auth with this SDK
			throw new Error("API key (geminiApiKey) is required for Google Generative AI client, even for Vertex")
		}
		this.options = options
		// Initialize the client. Credentials might need more complex handling for Vertex.
		this.client = new GoogleGenerativeAI(options.geminiApiKey)

		// TODO: Configure client further for Vertex specifics if needed (e.g., project/location)
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelInfo = this.getModel() // Gets VertexModelId and info
		const modelId = modelInfo.id

		// Remove Claude-specific logic as we are standardizing on the Gemini API via @google/generative-ai
		// if (modelId.includes("claude")) { ... }

		// Handle Gemini models on Vertex using @google/generative-ai client
		const modelOptions = {
			model: modelId, // Pass the Vertex model ID (e.g., gemini-1.5-pro-preview-0409)
			systemInstruction: systemPrompt,
		}
		const clientOptions = this.options.geminiBaseUrl ? { baseUrl: this.options.geminiBaseUrl } : undefined // Assuming same base URL logic applies

		// Use the getGenerativeModel structure
		const generativeModel = this.client.getGenerativeModel(modelOptions, clientOptions)

		// Prepare contents using the standardized conversion function
		const contents: Content[] = messages.map(convertAnthropicMessageToGemini)

		// Define generationConfig
		const generationConfig: GenerationConfig = {
			temperature: 0,
			// maxOutputTokens: modelInfo.info.maxTokens, // Optional
		}

		const result = await generativeModel.generateContentStream({
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
		const usageMetadata = response.usageMetadata
		if (usageMetadata) {
			const promptTokenCount = usageMetadata.promptTokenCount ?? 0
			const candidatesTokenCount = usageMetadata.candidatesTokenCount ?? 0
			yield {
				type: "usage",
				inputTokens: promptTokenCount,
				outputTokens: candidatesTokenCount,
				totalCost: calculateApiCostOpenAI(
					modelInfo.info, // Use modelInfo obtained earlier
					promptTokenCount,
					candidatesTokenCount,
					0,
					0,
				),
			}
		}
	}

	// Keep getModel specific to Vertex models
	getModel(): { id: VertexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId
			return { id, info: vertexModels[id] }
		}
		return {
			id: vertexDefaultModelId,
			info: vertexModels[vertexDefaultModelId],
		}
	}
}
