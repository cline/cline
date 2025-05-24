/**
 * Interface for code index embedders.
 * This interface is implemented by both OpenAI and Ollama embedders.
 */
export interface IEmbedder {
	/**
	 * Creates embeddings for the given texts.
	 * @param texts Array of text strings to create embeddings for
	 * @param model Optional model ID to use for embeddings
	 * @returns Promise resolving to an EmbeddingResponse
	 */
	createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse>
	get embedderInfo(): EmbedderInfo
}

export interface EmbeddingResponse {
	embeddings: number[][]
	usage?: {
		promptTokens: number
		totalTokens: number
	}
}

export type AvailableEmbedders = "openai" | "ollama"

export interface EmbedderInfo {
	name: AvailableEmbedders
}
