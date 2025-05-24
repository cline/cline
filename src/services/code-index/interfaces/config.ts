import { ApiHandlerOptions } from "../../../shared/api" // Adjust path if needed
import { EmbedderProvider } from "./manager"

/**
 * Configuration state for the code indexing feature
 */
export interface CodeIndexConfig {
	isEnabled: boolean
	isConfigured: boolean
	embedderProvider: EmbedderProvider
	modelId?: string
	openAiOptions?: ApiHandlerOptions
	ollamaOptions?: ApiHandlerOptions
	qdrantUrl?: string
	qdrantApiKey?: string
	searchMinScore?: number
}

/**
 * Snapshot of previous configuration used to determine if a restart is required
 */
export type PreviousConfigSnapshot = {
	enabled: boolean
	configured: boolean
	embedderProvider: EmbedderProvider
	modelId?: string
	openAiKey?: string
	ollamaBaseUrl?: string
	qdrantUrl?: string
	qdrantApiKey?: string
}
