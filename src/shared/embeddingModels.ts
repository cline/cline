/**
 * Defines profiles for different embedding models, including their dimensions.
 */

export type EmbedderProvider = "openai" | "ollama" // Add other providers as needed

export interface EmbeddingModelProfile {
	dimension: number
	// Add other model-specific properties if needed, e.g., context window size
}

export type EmbeddingModelProfiles = {
	[provider in EmbedderProvider]?: {
		[modelId: string]: EmbeddingModelProfile
	}
}

// Example profiles - expand this list as needed
export const EMBEDDING_MODEL_PROFILES: EmbeddingModelProfiles = {
	openai: {
		"text-embedding-3-small": { dimension: 1536 },
		"text-embedding-3-large": { dimension: 3072 },
		"text-embedding-ada-002": { dimension: 1536 },
	},
	ollama: {
		"nomic-embed-text": { dimension: 768 },
		"mxbai-embed-large": { dimension: 1024 },
		"all-minilm": { dimension: 384 },
		// Add default Ollama model if applicable, e.g.:
		// 'default': { dimension: 768 } // Assuming a default dimension
	},
}

/**
 * Retrieves the embedding dimension for a given provider and model ID.
 * @param provider The embedder provider (e.g., "openai").
 * @param modelId The specific model ID (e.g., "text-embedding-3-small").
 * @returns The dimension size or undefined if the model is not found.
 */
export function getModelDimension(provider: EmbedderProvider, modelId: string): number | undefined {
	const providerProfiles = EMBEDDING_MODEL_PROFILES[provider]
	if (!providerProfiles) {
		console.warn(`Provider not found in profiles: ${provider}`)
		return undefined
	}

	const modelProfile = providerProfiles[modelId]
	if (!modelProfile) {
		// Don't warn here, as it might be a custom model ID not in our profiles
		// console.warn(`Model not found for provider ${provider}: ${modelId}`)
		return undefined // Or potentially return a default/fallback dimension?
	}

	return modelProfile.dimension
}

/**
 * Gets the default *specific* embedding model ID based on the provider.
 * Does not include the provider prefix.
 * Currently defaults to OpenAI's 'text-embedding-3-small'.
 * TODO: Make this configurable or more sophisticated.
 * @param provider The embedder provider.
 * @returns The default specific model ID for the provider (e.g., "text-embedding-3-small").
 */
export function getDefaultModelId(provider: EmbedderProvider): string {
	// Simple default logic for now
	if (provider === "openai") {
		return "text-embedding-3-small"
	}
	if (provider === "ollama") {
		// Choose a sensible default for Ollama, e.g., the first one listed or a specific one
		const ollamaModels = EMBEDDING_MODEL_PROFILES.ollama
		const defaultOllamaModel = ollamaModels && Object.keys(ollamaModels)[0]
		if (defaultOllamaModel) {
			return defaultOllamaModel
		}
		// Fallback if no Ollama models are defined (shouldn't happen with the constant)
		console.warn("No default Ollama model found in profiles.")
		// Return a placeholder or throw an error, depending on desired behavior
		return "unknown-default" // Placeholder specific model ID
	}

	// Fallback for unknown providers
	console.warn(`Unknown provider for default model ID: ${provider}. Falling back to OpenAI default.`)
	return "text-embedding-3-small"
}
