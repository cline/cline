import type { ModelInfo } from "./types"

export interface ProviderModels {
	[modelId: string]: ModelInfo
}

export interface RegistryOutput {
	[providerName: string]: ProviderModels
}

class ModelRegistry {
	private providers: Map<string, ProviderModels> = new Map()
	private defaultModels: Map<string, string> = new Map()

	/**
	 * Register a provider with its models
	 * @param providerName - The name of the provider (e.g., "anthropic", "openai")
	 * @param models - A record of model IDs to their ModelInfo
	 */
	registerProvider(providerName: string, models: ProviderModels): void {
		const existing = this.providers.get(providerName) ?? {}
		this.providers.set(providerName, { ...existing, ...models })
	}

	/**
	 * Get all registered providers and their models as a JSON object
	 * @returns An object with provider names as keys and their models as values
	 */
	getAllModels(): RegistryOutput {
		const output: RegistryOutput = {}
		for (const [providerName, models] of this.providers) {
			output[providerName] = models
		}
		return output
	}

	/**
	 * Get models for a specific provider
	 * @param providerName - The name of the provider
	 * @returns The models for that provider, or undefined if not found
	 */
	getProviderModels(providerName: string): ProviderModels | undefined {
		return this.providers.get(providerName)
	}

	/**
	 * Get a specific model's info
	 * @param providerName - The name of the provider
	 * @param modelId - The model ID
	 * @returns The ModelInfo for that model, or undefined if not found
	 */
	getModel(providerName: string, modelId: string): ModelInfo | undefined {
		return this.providers.get(providerName)?.[modelId]
	}

	/**
	 * Get a list of all registered provider names
	 * @returns Array of provider names
	 */
	getProviderNames(): string[] {
		return Array.from(this.providers.keys())
	}

	/**
	 * Set the default model for a provider
	 * @param providerName - The name of the provider
	 * @param modelId - The model ID to set as default
	 * @throws Error if the provider or model doesn't exist
	 */
	setDefaultModel(providerName: string, modelId: string): void {
		const models = this.providers.get(providerName)
		if (!models) {
			throw new Error(`Provider "${providerName}" not found`)
		}
		if (!models[modelId]) {
			throw new Error(`Model "${modelId}" not found in provider "${providerName}"`)
		}
		this.defaultModels.set(providerName, modelId)
	}

	/**
	 * Get the default model for a provider
	 * Falls back to the first registered model if no default is set
	 * @param providerName - The name of the provider
	 * @returns The default model ID, or undefined if provider not found
	 */
	getDefaultModel(providerName: string): string | undefined {
		const explicitDefault = this.defaultModels.get(providerName)
		if (explicitDefault) {
			return explicitDefault
		}
		// Fall back to first registered model
		const models = this.providers.get(providerName)
		if (!models) {
			return undefined
		}
		const modelIds = Object.keys(models)
		return modelIds[0]
	}

	/**
	 * Get the default model info for a provider
	 * Falls back to the first registered model if no default is set
	 * @param providerName - The name of the provider
	 * @returns The ModelInfo for the default model, or undefined if provider not found
	 */
	getDefaultModelInfo(providerName: string): ModelInfo | undefined {
		const modelId = this.getDefaultModel(providerName)
		if (!modelId) {
			return undefined
		}
		return this.providers.get(providerName)?.[modelId]
	}

	/**
	 * Get all models as a JSON string
	 * @param pretty - Whether to format with indentation (default: true)
	 * @returns JSON string of all providers and models
	 */
	toJSON(pretty: boolean = true): string {
		return JSON.stringify(this.getAllModels(), null, pretty ? 2 : undefined)
	}
}

// Export a singleton instance for use across the application
export const modelRegistry = new ModelRegistry()

// Also export the class for testing or custom instances
export { ModelRegistry }
