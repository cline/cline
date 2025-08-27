import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import { MAX_ITEM_TOKENS } from "../constants"
import { t } from "../../../i18n"
import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

/**
 * Vercel AI Gateway embedder implementation that wraps the OpenAI Compatible embedder
 * with configuration for Vercel AI Gateway's embedding API.
 *
 * Supported models:
 * - openai/text-embedding-3-small (dimension: 1536)
 * - openai/text-embedding-3-large (dimension: 3072)
 * - openai/text-embedding-ada-002 (dimension: 1536)
 * - cohere/embed-v4.0 (dimension: 1024)
 * - google/gemini-embedding-001 (dimension: 768)
 * - google/text-embedding-005 (dimension: 768)
 * - google/text-multilingual-embedding-002 (dimension: 768)
 * - amazon/titan-embed-text-v2 (dimension: 1024)
 * - mistral/codestral-embed (dimension: 1536)
 * - mistral/mistral-embed (dimension: 1024)
 */
export class VercelAiGatewayEmbedder implements IEmbedder {
	private readonly openAICompatibleEmbedder: OpenAICompatibleEmbedder
	private static readonly VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"
	private static readonly DEFAULT_MODEL = "openai/text-embedding-3-large"
	private readonly modelId: string

	/**
	 * Creates a new Vercel AI Gateway embedder
	 * @param apiKey The Vercel AI Gateway API key for authentication
	 * @param modelId The model ID to use (defaults to mistral/codestral-embed)
	 */
	constructor(apiKey: string, modelId?: string) {
		if (!apiKey) {
			throw new Error(t("embeddings:validation.apiKeyRequired"))
		}

		// Use provided model or default
		this.modelId = modelId || VercelAiGatewayEmbedder.DEFAULT_MODEL

		// Create an OpenAI Compatible embedder with Vercel AI Gateway's configuration
		this.openAICompatibleEmbedder = new OpenAICompatibleEmbedder(
			VercelAiGatewayEmbedder.VERCEL_AI_GATEWAY_BASE_URL,
			apiKey,
			this.modelId,
			MAX_ITEM_TOKENS,
		)
	}

	/**
	 * Creates embeddings for the given texts using Vercel AI Gateway's embedding API
	 * @param texts Array of text strings to embed
	 * @param model Optional model identifier (uses constructor model if not provided)
	 * @returns Promise resolving to embedding response
	 */
	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		try {
			// Use the provided model or fall back to the instance's model
			const modelToUse = model || this.modelId
			return await this.openAICompatibleEmbedder.createEmbeddings(texts, modelToUse)
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "VercelAiGatewayEmbedder:createEmbeddings",
			})
			throw error
		}
	}

	/**
	 * Validates the Vercel AI Gateway embedder configuration by delegating to the underlying OpenAI-compatible embedder
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		try {
			// Delegate validation to the OpenAI-compatible embedder
			// The error messages will be specific to Vercel AI Gateway since we're using Vercel's base URL
			return await this.openAICompatibleEmbedder.validateConfiguration()
		} catch (error) {
			TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				location: "VercelAiGatewayEmbedder:validateConfiguration",
			})
			throw error
		}
	}

	/**
	 * Returns information about this embedder
	 */
	get embedderInfo(): EmbedderInfo {
		return {
			name: "vercel-ai-gateway",
		}
	}
}
