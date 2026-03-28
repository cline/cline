/**
 * Model Query Schema Definitions
 *
 * Zod schemas for configuring model queries and filters.
 * Users can use these to find models matching specific criteria.
 */

import { z } from "zod";
import {
	ApiFormatSchema,
	hasCapability,
	isDeprecated,
	ModelCapabilitySchema,
	type ModelInfo,
	ModelStatusSchema,
} from "./model";

// =============================================================================
// Query Configuration
// =============================================================================

/**
 * Configuration for querying models
 */
export const ModelQueryConfigSchema = z.object({
	/**
	 * Filter by provider IDs
	 * If not specified, returns models from all providers
	 */
	providers: z.array(z.string()).optional(),

	/**
	 * Filter by required capabilities
	 * Models must have ALL specified capabilities
	 */
	capabilities: z.array(ModelCapabilitySchema).optional(),

	/**
	 * Filter by any of these capabilities
	 * Models must have AT LEAST ONE of the specified capabilities
	 */
	anyCapabilities: z.array(ModelCapabilitySchema).optional(),

	/**
	 * Exclude models with these capabilities
	 */
	excludeCapabilities: z.array(ModelCapabilitySchema).optional(),

	/**
	 * Filter by model status
	 * If not specified, includes all statuses
	 */
	status: z.array(ModelStatusSchema).optional(),

	/**
	 * Include deprecated models
	 * @default false
	 */
	includeDeprecated: z.boolean().optional(),

	/**
	 * Filter by API format
	 */
	apiFormat: ApiFormatSchema.optional(),

	/**
	 * Filter by minimum context window size
	 */
	minContextWindow: z.number().optional(),

	/**
	 * Filter by maximum context window size
	 */
	maxContextWindow: z.number().optional(),

	/**
	 * Filter by minimum output tokens
	 */
	minMaxTokens: z.number().optional(),

	/**
	 * Filter by maximum price per million input tokens
	 */
	maxInputPrice: z.number().optional(),

	/**
	 * Filter by maximum price per million output tokens
	 */
	maxOutputPrice: z.number().optional(),

	/**
	 * Search by model name or ID (case-insensitive partial match)
	 */
	search: z.string().optional(),

	/**
	 * Only return models with thinking/reasoning support
	 */
	hasThinking: z.boolean().optional(),

	/**
	 * Sort results by field
	 */
	sortBy: z
		.enum(["name", "contextWindow", "maxTokens", "inputPrice", "outputPrice"])
		.optional(),

	/**
	 * Sort direction
	 * @default "asc"
	 */
	sortDirection: z.enum(["asc", "desc"]).optional(),

	/**
	 * Limit number of results
	 */
	limit: z.number().optional(),
});

export type ModelQueryConfig = z.infer<typeof ModelQueryConfigSchema>;

// =============================================================================
// Query Result
// =============================================================================

/**
 * Result of a model query
 */
export const ModelQueryResultSchema = z.object({
	/** Matching models with their provider */
	models: z.array(
		z.object({
			providerId: z.string(),
			modelId: z.string(),
			info: z.any(), // ModelInfoSchema but avoiding circular ref
		}),
	),
	/** Total count before limit */
	total: z.number(),
	/** Query config used */
	config: ModelQueryConfigSchema,
});

export type ModelQueryResult = z.infer<typeof ModelQueryResultSchema>;

// =============================================================================
// Model Match Result
// =============================================================================

export interface ModelMatch {
	providerId: string;
	modelId: string;
	info: ModelInfo;
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Check if a model matches the query config
 */
export function matchesQuery(
	modelId: string,
	info: ModelInfo,
	config: ModelQueryConfig,
): boolean {
	// Check deprecated filter
	if (!config.includeDeprecated && isDeprecated(info)) {
		return false;
	}

	// Check status filter
	if (config.status && config.status.length > 0) {
		const modelStatus = info.status ?? "active";
		if (!config.status.includes(modelStatus)) {
			return false;
		}
	}

	// Check required capabilities (ALL must be present)
	if (config.capabilities && config.capabilities.length > 0) {
		const hasAll = config.capabilities.every((cap) => hasCapability(info, cap));
		if (!hasAll) {
			return false;
		}
	}

	// Check any capabilities (AT LEAST ONE must be present)
	if (config.anyCapabilities && config.anyCapabilities.length > 0) {
		const hasAny = config.anyCapabilities.some((cap) =>
			hasCapability(info, cap),
		);
		if (!hasAny) {
			return false;
		}
	}

	// Check excluded capabilities (NONE must be present)
	if (config.excludeCapabilities && config.excludeCapabilities.length > 0) {
		const hasExcluded = config.excludeCapabilities.some((cap) =>
			hasCapability(info, cap),
		);
		if (hasExcluded) {
			return false;
		}
	}

	// Check API format
	if (config.apiFormat && info.apiFormat !== config.apiFormat) {
		return false;
	}

	// Check context window bounds
	if (
		config.minContextWindow &&
		(info.contextWindow ?? 0) < config.minContextWindow
	) {
		return false;
	}
	if (
		config.maxContextWindow &&
		(info.contextWindow ?? Number.POSITIVE_INFINITY) > config.maxContextWindow
	) {
		return false;
	}

	// Check max tokens
	if (config.minMaxTokens && (info.maxTokens ?? 0) < config.minMaxTokens) {
		return false;
	}

	// Check pricing bounds
	if (
		config.maxInputPrice &&
		(info.pricing?.input ?? Number.POSITIVE_INFINITY) > config.maxInputPrice
	) {
		return false;
	}
	if (
		config.maxOutputPrice &&
		(info.pricing?.output ?? Number.POSITIVE_INFINITY) > config.maxOutputPrice
	) {
		return false;
	}

	// Check search term
	if (config.search) {
		const searchLower = config.search.toLowerCase();
		const nameMatch = info.name?.toLowerCase().includes(searchLower) ?? false;
		const idMatch = modelId.toLowerCase().includes(searchLower);
		const descMatch =
			info.description?.toLowerCase().includes(searchLower) ?? false;
		if (!nameMatch && !idMatch && !descMatch) {
			return false;
		}
	}

	// Check thinking support
	if (config.hasThinking === true && !info.thinkingConfig) {
		return false;
	}
	if (config.hasThinking === false && info.thinkingConfig) {
		return false;
	}

	return true;
}

/**
 * Sort model results
 */
export function sortModels(
	models: ModelMatch[],
	sortBy: ModelQueryConfig["sortBy"],
	direction: "asc" | "desc" = "asc",
): ModelMatch[] {
	if (!sortBy) {
		return models;
	}

	const sorted = [...models].sort((a, b) => {
		let aVal: number | string;
		let bVal: number | string;

		switch (sortBy) {
			case "name":
				aVal = a.info.name ?? a.modelId;
				bVal = b.info.name ?? b.modelId;
				break;
			case "contextWindow":
				aVal = a.info.contextWindow ?? 0;
				bVal = b.info.contextWindow ?? 0;
				break;
			case "maxTokens":
				aVal = a.info.maxTokens ?? 0;
				bVal = b.info.maxTokens ?? 0;
				break;
			case "inputPrice":
				aVal = a.info.pricing?.input ?? Number.POSITIVE_INFINITY;
				bVal = b.info.pricing?.input ?? Number.POSITIVE_INFINITY;
				break;
			case "outputPrice":
				aVal = a.info.pricing?.output ?? Number.POSITIVE_INFINITY;
				bVal = b.info.pricing?.output ?? Number.POSITIVE_INFINITY;
				break;
			default:
				return 0;
		}

		if (typeof aVal === "string" && typeof bVal === "string") {
			return aVal.localeCompare(bVal);
		}

		return (aVal as number) - (bVal as number);
	});

	return direction === "desc" ? sorted.reverse() : sorted;
}

/**
 * Validate query config
 */
export function validateQueryConfig(data: unknown): ModelQueryConfig {
	return ModelQueryConfigSchema.parse(data);
}

/**
 * Safely validate query config (returns undefined on failure)
 */
export function safeValidateQueryConfig(
	data: unknown,
): ModelQueryConfig | undefined {
	const result = ModelQueryConfigSchema.safeParse(data);
	return result.success ? result.data : undefined;
}
