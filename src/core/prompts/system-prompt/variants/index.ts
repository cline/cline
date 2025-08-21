/**
 * Variant Registry - Central hub for all prompt variants
 *
 * This file exports all variant configurations and provides a registry
 * for dynamic loading. Each variant is optimized for specific model families
 * and use cases.
 */

// Direct exports for static imports
export { config as genericConfig, type GenericVariantConfig } from "./generic/config"
export { config as nextGenConfig, type NextGenVariantConfig } from "./next-gen/config"
export { config as xsConfig, type XsVariantConfig } from "./xs/config"

/**
 * Variant Registry for dynamic loading
 *
 * This registry allows for lazy loading of variant configurations,
 * which is useful for reducing initial bundle size and enabling
 * runtime variant selection.
 */
export const VARIANT_CONFIGS = {
	/**
	 * Generic variant - Fallback for all model types
	 * Optimized for broad compatibility and stable performance
	 */
	generic: () => import("./generic/config").then((m) => m.config),

	/**
	 * Next-gen variant - Advanced models with enhanced capabilities
	 * Includes additional features like feedback loops and web fetching
	 */
	"next-gen": () => import("./next-gen/config").then((m) => m.config),

	/**
	 * XS variant - Compact models with limited context windows
	 * Streamlined for efficiency with essential tools only
	 */
	xs: () => import("./xs/config").then((m) => m.config),
} as const

/**
 * Type-safe variant identifier
 * Ensures only valid variant IDs can be used throughout the codebase
 */
export type VariantId = keyof typeof VARIANT_CONFIGS

/**
 * Helper function to get all available variant IDs
 */
export function getAvailableVariants(): VariantId[] {
	return Object.keys(VARIANT_CONFIGS) as VariantId[]
}

/**
 * Helper function to check if a variant ID is valid
 */
export function isValidVariantId(id: string): id is VariantId {
	return id in VARIANT_CONFIGS
}

/**
 * Load a variant configuration dynamically
 * @param variantId - The ID of the variant to load
 * @returns Promise that resolves to the variant configuration
 */
export async function loadVariantConfig(variantId: VariantId) {
	const loader = VARIANT_CONFIGS[variantId]
	return await loader()
}

/**
 * Load all variant configurations
 * @returns Promise that resolves to a map of all variant configurations
 */
export async function loadAllVariantConfigs() {
	const entries = await Promise.all(Object.entries(VARIANT_CONFIGS).map(async ([id, loader]) => [id, await loader()] as const))
	return Object.fromEntries(entries) as Record<VariantId, Awaited<ReturnType<(typeof VARIANT_CONFIGS)[VariantId]>>>
}
