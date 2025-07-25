import { ApiHandlerOptions } from "../../../shared/api"
import { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces"
import { getModelQueryPrefix } from "../../../shared/embeddingModels"
import { MAX_ITEM_TOKENS } from "../constants"
import { t } from "../../../i18n"
import { withValidationErrorHandling, sanitizeErrorMessage } from "../shared/validation-helpers"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

// Timeout constants for Ollama API requests
const OLLAMA_EMBEDDING_TIMEOUT_MS = 60000 // 60 seconds for embedding requests
const OLLAMA_VALIDATION_TIMEOUT_MS = 30000 // 30 seconds for validation requests

/**
 * Implements the IEmbedder interface using a local Ollama instance.
 */
export class CodeIndexOllamaEmbedder implements IEmbedder {
	private readonly baseUrl: string
	private readonly defaultModelId: string

	constructor(options: ApiHandlerOptions) {
		// Ensure ollamaBaseUrl and ollamaModelId exist on ApiHandlerOptions or add defaults
		let baseUrl = options.ollamaBaseUrl || "http://localhost:11434"

		// Normalize the baseUrl by removing all trailing slashes
		baseUrl = baseUrl.replace(/\/+$/, "")

		this.baseUrl = baseUrl
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

		// Apply model-specific query prefix if required
		const queryPrefix = getModelQueryPrefix("ollama", modelToUse)
		const processedTexts = queryPrefix
			? texts.map((text, index) => {
					// Prevent double-prefixing
					if (text.startsWith(queryPrefix)) {
						return text
					}
					const prefixedText = `${queryPrefix}${text}`
					const estimatedTokens = Math.ceil(prefixedText.length / 4)
					if (estimatedTokens > MAX_ITEM_TOKENS) {
						console.warn(
							t("embeddings:textWithPrefixExceedsTokenLimit", {
								index,
								estimatedTokens,
								maxTokens: MAX_ITEM_TOKENS,
							}),
						)
						// Return original text if adding prefix would exceed limit
						return text
					}
					return prefixedText
				})
			: texts

		try {
			// Note: Standard Ollama API uses 'prompt' for single text, not 'input' for array.
			// Implementing based on user's specific request structure.

			// Add timeout to prevent indefinite hanging
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), OLLAMA_EMBEDDING_TIMEOUT_MS)

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: modelToUse,
					input: processedTexts, // Using 'input' as requested
				}),
				signal: controller.signal,
			})
			clearTimeout(timeoutId)

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
			// Capture telemetry before reformatting the error
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
				stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
				location: "OllamaEmbedder:createEmbeddings",
			})

			// Log the original error for debugging purposes
			console.error("Ollama embedding failed:", error)

			// Handle specific error types with better messages
			if (error.name === "AbortError") {
				throw new Error(t("embeddings:validation.connectionFailed"))
			} else if (error.message?.includes("fetch failed") || error.code === "ECONNREFUSED") {
				throw new Error(t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }))
			} else if (error.code === "ENOTFOUND") {
				throw new Error(t("embeddings:ollama.hostNotFound", { baseUrl: this.baseUrl }))
			}

			// Re-throw a more specific error for the caller
			throw new Error(t("embeddings:ollama.embeddingFailed", { message: error.message }))
		}
	}

	/**
	 * Validates the Ollama embedder configuration by checking service availability and model existence
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		return withValidationErrorHandling(
			async () => {
				// First check if Ollama service is running by trying to list models
				const modelsUrl = `${this.baseUrl}/api/tags`

				// Add timeout to prevent indefinite hanging
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), OLLAMA_VALIDATION_TIMEOUT_MS)

				const modelsResponse = await fetch(modelsUrl, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
					signal: controller.signal,
				})
				clearTimeout(timeoutId)

				if (!modelsResponse.ok) {
					if (modelsResponse.status === 404) {
						return {
							valid: false,
							error: t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					}
					return {
						valid: false,
						error: t("embeddings:ollama.serviceUnavailable", {
							baseUrl: this.baseUrl,
							status: modelsResponse.status,
						}),
					}
				}

				// Check if the specific model exists
				const modelsData = await modelsResponse.json()
				const models = modelsData.models || []

				// Check both with and without :latest suffix
				const modelExists = models.some((m: any) => {
					const modelName = m.name || ""
					return (
						modelName === this.defaultModelId ||
						modelName === `${this.defaultModelId}:latest` ||
						modelName === this.defaultModelId.replace(":latest", "")
					)
				})

				if (!modelExists) {
					const availableModels = models.map((m: any) => m.name).join(", ")
					return {
						valid: false,
						error: t("embeddings:ollama.modelNotFound", {
							modelId: this.defaultModelId,
							availableModels,
						}),
					}
				}

				// Try a test embedding to ensure the model works for embeddings
				const testUrl = `${this.baseUrl}/api/embed`

				// Add timeout for test request too
				const testController = new AbortController()
				const testTimeoutId = setTimeout(() => testController.abort(), OLLAMA_VALIDATION_TIMEOUT_MS)

				const testResponse = await fetch(testUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: this.defaultModelId,
						input: ["test"],
					}),
					signal: testController.signal,
				})
				clearTimeout(testTimeoutId)

				if (!testResponse.ok) {
					return {
						valid: false,
						error: t("embeddings:ollama.modelNotEmbeddingCapable", { modelId: this.defaultModelId }),
					}
				}

				return { valid: true }
			},
			"ollama",
			{
				beforeStandardHandling: (error: any) => {
					// Handle Ollama-specific connection errors
					// Check for fetch failed errors which indicate Ollama is not running
					if (
						error?.message?.includes("fetch failed") ||
						error?.code === "ECONNREFUSED" ||
						error?.message?.includes("ECONNREFUSED")
					) {
						// Capture telemetry for connection failed error
						TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
							error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
							stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
							location: "OllamaEmbedder:validateConfiguration:connectionFailed",
						})
						return {
							valid: false,
							error: t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					} else if (error?.code === "ENOTFOUND" || error?.message?.includes("ENOTFOUND")) {
						// Capture telemetry for host not found error
						TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
							error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
							stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
							location: "OllamaEmbedder:validateConfiguration:hostNotFound",
						})
						return {
							valid: false,
							error: t("embeddings:ollama.hostNotFound", { baseUrl: this.baseUrl }),
						}
					} else if (error?.name === "AbortError") {
						// Capture telemetry for timeout error
						TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
							error: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
							stack: error instanceof Error ? sanitizeErrorMessage(error.stack || "") : undefined,
							location: "OllamaEmbedder:validateConfiguration:timeout",
						})
						// Handle timeout
						return {
							valid: false,
							error: t("embeddings:validation.connectionFailed"),
						}
					}
					// Let standard handling take over
					return undefined
				},
			},
		)
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "ollama",
		}
	}
}
