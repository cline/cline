import { ApiHandlerOptions } from "../../../shared/api"
import { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces"
import { t } from "../../../i18n"

/**
 * Implements the IEmbedder interface using a local Ollama instance.
 */
export class CodeIndexOllamaEmbedder implements IEmbedder {
	private readonly baseUrl: string
	private readonly defaultModelId: string

	constructor(options: ApiHandlerOptions) {
		// Ensure ollamaBaseUrl and ollamaModelId exist on ApiHandlerOptions or add defaults
		this.baseUrl = options.ollamaBaseUrl || "http://localhost:11434"
		this.defaultModelId = options.ollamaModelId || "nomic-embed-text:latest"
	}

	/**
	 * Creates embeddings for the given texts using the specified Ollama model.
	 * @param texts - An array of strings to embed.
	 * @param model - Optional model ID to override the default.
	 * @returns A promise that resolves to an EmbeddingResponse containing the embeddings and usage data.
	 */
	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		const modelToUse = model || this.defaultModelId
		const url = `${this.baseUrl}/api/embed` // Endpoint as specified

		try {
			// Note: Standard Ollama API uses 'prompt' for single text, not 'input' for array.
			// Implementing based on user's specific request structure.
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: modelToUse,
					input: texts, // Using 'input' as requested
				}),
			})

			if (!response.ok) {
				let errorBody = t("embeddings:ollama.couldNotReadErrorBody")
				try {
					errorBody = await response.text()
				} catch (e) {
					// Ignore error reading body
				}
				throw new Error(
					t("embeddings:ollama.requestFailed", {
						status: response.status,
						statusText: response.statusText,
						errorBody,
					}),
				)
			}

			const data = await response.json()

			// Extract embeddings using 'embeddings' key as requested
			const embeddings = data.embeddings
			if (!embeddings || !Array.isArray(embeddings)) {
				throw new Error(t("embeddings:ollama.invalidResponseStructure"))
			}

			return {
				embeddings: embeddings,
			}
		} catch (error: any) {
			// Log the original error for debugging purposes
			console.error("Ollama embedding failed:", error)
			// Re-throw a more specific error for the caller
			throw new Error(t("embeddings:ollama.embeddingFailed", { message: error.message }))
		}
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "ollama",
		}
	}
}
