/**
 * Model Query API
 *
 * High-level API for querying and filtering models across all providers.
 * Uses the registry and schema validation for type-safe queries.
 */

import { getAllModels, getModelsForProvider, getProviderIds } from "./registry";
import {
	type ModelMatch,
	type ModelQueryConfig,
	ModelQueryConfigSchema,
	matchesQuery,
	sortModels,
} from "./types/index";

// =============================================================================
// Query Execution
// =============================================================================

/**
 * Query models using a configuration object
 *
 * @example
 * ```typescript
 * // Get all models with image support
 * const imageModels = queryModels({
 *   capabilities: ["images"],
 * })
 *
 * // Get cheap reasoning models
 * const cheapReasoning = queryModels({
 *   capabilities: ["reasoning"],
 *   maxInputPrice: 1,
 *   sortBy: "inputPrice",
 * })
 *
 * // Get Anthropic and OpenAI models
 * const models = queryModels({
 *   providers: ["anthropic", "openai"],
 *   includeDeprecated: false,
 * })
 * ```
 */
export function queryModels(config: ModelQueryConfig): ModelMatch[] {
	// Validate config
	const validatedConfig = ModelQueryConfigSchema.parse(config);

	// Determine which providers to search
	const providerIds = validatedConfig.providers?.length
		? validatedConfig.providers.filter((id) => getProviderIds().includes(id))
		: getProviderIds();

	// Collect matching models
	const matches: ModelMatch[] = [];

	for (const providerId of providerIds) {
		const models = getModelsForProvider(providerId);

		for (const [modelId, info] of Object.entries(models)) {
			if (matchesQuery(modelId, info, validatedConfig)) {
				matches.push({ providerId, modelId, info });
			}
		}
	}

	// Sort results
	const sorted = sortModels(
		matches,
		validatedConfig.sortBy,
		validatedConfig.sortDirection ?? "asc",
	);

	// Apply limit
	if (validatedConfig.limit && validatedConfig.limit > 0) {
		return sorted.slice(0, validatedConfig.limit);
	}

	return sorted;
}

// =============================================================================
// Convenience Query Functions
// =============================================================================

/**
 * Get all models with vision/image capabilities
 */
export function getVisionModels(): ModelMatch[] {
	return queryModels({ capabilities: ["images"] });
}

/**
 * Get all models with reasoning/thinking capabilities
 */
export function getReasoningModels(): ModelMatch[] {
	return queryModels({ capabilities: ["reasoning"] });
}

/**
 * Get all models with prompt caching support
 */
export function getCachingModels(): ModelMatch[] {
	return queryModels({ capabilities: ["prompt-cache"] });
}

/**
 * Get all models with tool/function calling support
 */
export function getToolModels(): ModelMatch[] {
	return queryModels({ capabilities: ["tools"] });
}

/**
 * Get all models supporting computer use
 */
export function getComputerUseModels(): ModelMatch[] {
	return queryModels({ capabilities: ["computer-use"] });
}

/**
 * Get all active (non-deprecated) models
 */
export function getActiveModels(): ModelMatch[] {
	return queryModels({
		includeDeprecated: false,
		status: ["active", "preview"],
	});
}

/**
 * Get all deprecated models
 */
export function getDeprecatedModels(): ModelMatch[] {
	return queryModels({
		includeDeprecated: true,
		status: ["deprecated"],
	});
}

/**
 * Get models within a price range (input price per million tokens)
 */
export function getModelsInPriceRange(
	maxInputPrice: number,
	maxOutputPrice?: number,
): ModelMatch[] {
	return queryModels({
		maxInputPrice,
		maxOutputPrice,
		sortBy: "inputPrice",
	});
}

/**
 * Get models with minimum context window size
 */
export function getModelsWithContextWindow(minTokens: number): ModelMatch[] {
	return queryModels({
		minContextWindow: minTokens,
		sortBy: "contextWindow",
		sortDirection: "desc",
	});
}

/**
 * Get models by provider
 */
export function getModelsByProvider(providerId: string): ModelMatch[] {
	return queryModels({ providers: [providerId] });
}

/**
 * Search models by name or ID
 */
export function searchModels(searchTerm: string): ModelMatch[] {
	return queryModels({ search: searchTerm });
}

// =============================================================================
// Query Builder (Fluent API)
// =============================================================================

/**
 * Fluent query builder for constructing model queries
 *
 * @example
 * ```typescript
 * const models = createQuery()
 *   .fromProviders(["anthropic", "openai"])
 *   .withCapabilities(["images", "reasoning"])
 *   .maxPrice({ input: 5 })
 *   .sortBy("inputPrice")
 *   .limit(10)
 *   .execute()
 * ```
 */
export class ModelQueryBuilder {
	private config: ModelQueryConfig = {};

	/**
	 * Filter by provider IDs
	 */
	fromProviders(providers: string[]): this {
		this.config.providers = providers;
		return this;
	}

	/**
	 * Require all specified capabilities
	 */
	withCapabilities(capabilities: ModelQueryConfig["capabilities"]): this {
		this.config.capabilities = capabilities;
		return this;
	}

	/**
	 * Require at least one of the specified capabilities
	 */
	withAnyCapabilities(capabilities: ModelQueryConfig["anyCapabilities"]): this {
		this.config.anyCapabilities = capabilities;
		return this;
	}

	/**
	 * Exclude models with specified capabilities
	 */
	excludeCapabilities(
		capabilities: ModelQueryConfig["excludeCapabilities"],
	): this {
		this.config.excludeCapabilities = capabilities;
		return this;
	}

	/**
	 * Filter by model status
	 */
	withStatus(status: ModelQueryConfig["status"]): this {
		this.config.status = status;
		return this;
	}

	/**
	 * Include deprecated models
	 */
	includeDeprecated(include = true): this {
		this.config.includeDeprecated = include;
		return this;
	}

	/**
	 * Filter by API format
	 */
	withApiFormat(format: ModelQueryConfig["apiFormat"]): this {
		this.config.apiFormat = format;
		return this;
	}

	/**
	 * Filter by context window size
	 */
	contextWindow(options: { min?: number; max?: number }): this {
		if (options.min !== undefined) {
			this.config.minContextWindow = options.min;
		}
		if (options.max !== undefined) {
			this.config.maxContextWindow = options.max;
		}
		return this;
	}

	/**
	 * Filter by minimum output tokens
	 */
	minMaxTokens(tokens: number): this {
		this.config.minMaxTokens = tokens;
		return this;
	}

	/**
	 * Filter by maximum price
	 */
	maxPrice(options: { input?: number; output?: number }): this {
		if (options.input !== undefined) {
			this.config.maxInputPrice = options.input;
		}
		if (options.output !== undefined) {
			this.config.maxOutputPrice = options.output;
		}
		return this;
	}

	/**
	 * Search by name or ID
	 */
	search(term: string): this {
		this.config.search = term;
		return this;
	}

	/**
	 * Filter by thinking/reasoning support
	 */
	hasThinking(has = true): this {
		this.config.hasThinking = has;
		return this;
	}

	/**
	 * Sort results
	 */
	sortBy(
		field: ModelQueryConfig["sortBy"],
		direction: ModelQueryConfig["sortDirection"] = "asc",
	): this {
		this.config.sortBy = field;
		this.config.sortDirection = direction;
		return this;
	}

	/**
	 * Limit number of results
	 */
	limit(count: number): this {
		this.config.limit = count;
		return this;
	}

	/**
	 * Get the current config
	 */
	getConfig(): ModelQueryConfig {
		return { ...this.config };
	}

	/**
	 * Execute the query
	 */
	execute(): ModelMatch[] {
		return queryModels(this.config);
	}
}

/**
 * Create a new query builder
 */
export function createQuery(): ModelQueryBuilder {
	return new ModelQueryBuilder();
}

// =============================================================================
// Statistics
// =============================================================================

/**
 * Get statistics about registered models
 */
export async function getModelStatistics(): Promise<{
	totalModels: number;
	modelsByProvider: Record<string, number>;
	modelsByCapability: Record<string, number>;
	modelsByStatus: Record<string, number>;
	priceRange: { min: number; max: number; avg: number };
}> {
	const allModels = await getAllModels();

	const modelsByProvider: Record<string, number> = {};
	const modelsByCapability: Record<string, number> = {};
	const modelsByStatus: Record<string, number> = {};
	const prices: number[] = [];

	for (const { providerId, info } of allModels) {
		// Count by provider
		modelsByProvider[providerId] = (modelsByProvider[providerId] ?? 0) + 1;

		// Count by capability
		for (const cap of info.capabilities ?? []) {
			modelsByCapability[cap] = (modelsByCapability[cap] ?? 0) + 1;
		}

		// Count by status
		const status = info.status ?? "active";
		modelsByStatus[status] = (modelsByStatus[status] ?? 0) + 1;

		// Collect prices
		if (info.pricing?.input !== undefined) {
			prices.push(info.pricing.input);
		}
	}

	// Calculate price statistics
	const sortedPrices = prices.sort((a, b) => a - b);
	const priceRange = {
		min: sortedPrices[0] ?? 0,
		max: sortedPrices[sortedPrices.length - 1] ?? 0,
		avg:
			prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
	};

	return {
		totalModels: allModels.length,
		modelsByProvider,
		modelsByCapability,
		modelsByStatus,
		priceRange,
	};
}
