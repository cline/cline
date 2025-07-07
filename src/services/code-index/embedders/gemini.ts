import { OpenAICompatibleEmbedder } from "./openai-compatible"
import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces/embedder"
import { GEMINI_MAX_ITEM_TOKENS } from "../constants"

/**
 * Gemini embedder implementation that wraps the OpenAI Compatible embedder
 * with fixed configuration for Google's Gemini embedding API.
 *
 * Fixed values:
 * - Base URL: https://generativelanguage.googleapis.com/v1beta/openai/
 * - Model: text-embedding-004
 * - Dimension: 768
 */
export class GeminiEmbedder implements IEmbedder {
	private readonly openAICompatibleEmbedder: OpenAICompatibleEmbedder
	private static readonly GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
	private static readonly GEMINI_MODEL = "text-embedding-004"
	private static readonly GEMINI_DIMENSION = 768

	/**
	 * Creates a new Gemini embedder
	 * @param apiKey The Gemini API key for authentication
	 */
	constructor(apiKey: string) {
		if (!apiKey) {
			throw new Error("API key is required for Gemini embedder")
		}

		// Create an OpenAI Compatible embedder with Gemini's fixed configuration
		this.openAICompatibleEmbedder = new OpenAICompatibleEmbedder(
			GeminiEmbedder.GEMINI_BASE_URL,
			apiKey,
			GeminiEmbedder.GEMINI_MODEL,
			GEMINI_MAX_ITEM_TOKENS,
		)
	}

	/**
	 * Creates embeddings for the given texts using Gemini's embedding API
	 * @param texts Array of text strings to embed
	 * @param model Optional model identifier (ignored - always uses text-embedding-004)
	 * @returns Promise resolving to embedding response
	 */
	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		// Always use the fixed Gemini model, ignoring any passed model parameter
		return this.openAICompatibleEmbedder.createEmbeddings(texts, GeminiEmbedder.GEMINI_MODEL)
	}

	/**
	 * Validates the Gemini embedder configuration by delegating to the underlying OpenAI-compatible embedder
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		// Delegate validation to the OpenAI-compatible embedder
		// The error messages will be specific to Gemini since we're using Gemini's base URL
		return this.openAICompatibleEmbedder.validateConfiguration()
	}

	/**
	 * Returns information about this embedder
	 */
	get embedderInfo(): EmbedderInfo {
		return {
			name: "gemini",
		}
	}

	/**
	 * Gets the fixed dimension for Gemini embeddings
	 */
	static get dimension(): number {
		return GeminiEmbedder.GEMINI_DIMENSION
	}
}
