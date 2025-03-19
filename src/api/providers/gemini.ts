/**
 * Implementation of ApiHandler for Google's Gemini models.
 * This handler adapts Gemini's API to the common ApiHandler interface,
 * allowing Gemini models to be used with an Anthropic-compatible system.
 *
 * @example
 * // Basic usage example:
 * const handler = new GeminiHandler({
 *   geminiApiKey: "YOUR_API_KEY",
 *   apiModelId: "gemini-1.5-pro-002" // Optional: specify a model
 * });
 *
 * // Generate a response (streaming)
 * async function generateResponse() {
 *   const systemPrompt = "You are a helpful assistant.";
 *   const messages = [{ role: "user", content: "Hello, who are you?" }];
 *
 *   for await (const chunk of handler.createMessage(systemPrompt, messages)) {
 *     if (chunk.type === "text") {
 *       console.log(chunk.text); // Process text chunks
 *     } else if (chunk.type === "usage") {
 *       console.log(`Input tokens: ${chunk.inputTokens}, Output tokens: ${chunk.outputTokens}`);
 *     }
 *   }
 * }
 *
 * @see docs/architecture/gemini-integration.md for detailed documentation
 */
import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "../../shared/api"
import { convertAnthropicMessageToGemini, unescapeGeminiContent } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

/**
 * Handler for interacting with Google's Gemini API.
 * Implements the common ApiHandler interface, providing message generation
 * and model selection functionality compatible with the application's
 * Anthropic-based architecture.
 *
 * @example
 * // Create a handler with specific model
 * const handler = new GeminiHandler({
 *   geminiApiKey: process.env.GEMINI_API_KEY,
 *   apiModelId: "gemini-2.0-flash-001"
 * });
 *
 * @example
 * // Create a handler with default model
 * const handler = new GeminiHandler({
 *   geminiApiKey: process.env.GEMINI_API_KEY
 * });
 */
export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenerativeAI

	/**
	 * Creates a new GeminiHandler instance.
	 *
	 * @param options - Configuration options including the Gemini API key
	 * @throws Error if geminiApiKey is not provided in options
	 *
	 * @example
	 * const handler = new GeminiHandler({
	 *   geminiApiKey: "YOUR_GEMINI_API_KEY",
	 *   apiModelId: "gemini-1.5-pro-002" // Optional
	 * });
	 */
	constructor(options: ApiHandlerOptions) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options
		this.client = new GoogleGenerativeAI(options.geminiApiKey)
	}

	/**
	 * Generates content from Gemini models based on messages in Anthropic format.
	 * Uses stream processing to return results as they become available.
	 * Decorated with @withRetry to automatically retry on transient failures.
	 *
	 * @param systemPrompt - Instructions to guide the model's behavior
	 * @param messages - Array of messages in Anthropic format
	 * @yields Streaming text content and usage information
	 *
	 * @example
	 * // Basic usage with text-only content
	 * const systemPrompt = "You are a helpful AI assistant.";
	 * const messages = [{ role: "user", content: "What is the capital of France?" }];
	 *
	 * for await (const chunk of handler.createMessage(systemPrompt, messages)) {
	 *   if (chunk.type === "text") {
	 *     console.log(chunk.text);
	 *   } else if (chunk.type === "usage") {
	 *     console.log(`Tokens used: ${chunk.inputTokens + chunk.outputTokens}`);
	 *   }
	 * }
	 *
	 * @example
	 * // Using with image content
	 * const systemPrompt = "Describe the image in detail.";
	 * const messages = [{
	 *   role: "user",
	 *   content: [
	 *     { type: "text", text: "What's in this image?" },
	 *     {
	 *       type: "image",
	 *       source: {
	 *         type: "base64",
	 *         data: "base64EncodedImageData",
	 *         media_type: "image/jpeg"
	 *       }
	 *     }
	 *   ]
	 * }];
	 *
	 * for await (const chunk of handler.createMessage(systemPrompt, messages)) {
	 *   // Process chunks...
	 * }
	 */
	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.client.getGenerativeModel({
			model: this.getModel().id,
			systemInstruction: systemPrompt,
		})

		try {
			const result = await model.generateContentStream({
				contents: messages.map(convertAnthropicMessageToGemini),
				generationConfig: {
					maxOutputTokens: this.getModel().info.maxTokens,
					temperature: 0, // Consistent with other handlers in the codebase
				},
			})

			let hasError = false
			for await (const chunk of result.stream) {
				try {
					const text = chunk.text()
					if (text) {
						yield {
							type: "text",
							text: unescapeGeminiContent(text),
						}
					}
				} catch (error) {
					hasError = true
					console.error("Error processing stream chunk:", error)
					throw error
				}
			}

			if (hasError) {
				throw new Error("Stream processing encountered errors")
			}

			const response = await result.response
			if (!response) {
				throw new Error("No response received from Gemini API")
			}

			// Check for finish reason
			const finishReason = response.candidates?.[0]?.finishReason
			if (finishReason === "SAFETY") {
				throw new Error("Content generation was blocked for safety reasons")
			} else if (finishReason === "RECITATION") {
				throw new Error("Content generation was blocked due to potential copyright issues")
			} else if (finishReason === "OTHER") {
				throw new Error("Content generation was blocked for other reasons")
			}

			yield {
				type: "usage",
				inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
				outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
			}
		} catch (error) {
			console.error("Error in Gemini message generation:", error)
			throw error
		}
	}

	/**
	 * Determines which Gemini model to use based on configuration or defaults.
	 *
	 * @returns Object containing the model ID and associated model information
	 *
	 * @example
	 * const handler = new GeminiHandler({ geminiApiKey: "YOUR_API_KEY" });
	 * const { id, info } = handler.getModel();
	 * console.log(`Using model: ${id}, max tokens: ${info.maxTokens}`);
	 */
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
