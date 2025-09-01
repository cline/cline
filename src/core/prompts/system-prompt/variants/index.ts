/**
 * Variant Registry - Central hub for all prompt variants
 *
 * This file exports all variant configurations and provides a registry
 * for dynamic loading. Each variant is optimized for specific model families
 * and use cases.
 */

export { config as genericConfig, type GenericVariantConfig } from "./generic/config"
export { config as gpt5Config, type GPT5VariantConfig } from "./gpt-5/config"
export { config as nextGenConfig, type NextGenVariantConfig } from "./next-gen/config"
export { config as xsConfig, type XsVariantConfig } from "./xs/config"

import { config as genericConfig } from "./generic/config"
import { config as gpt5Config } from "./gpt-5/config"
import { config as nextGenConfig } from "./next-gen/config"
import { config as xsConfig } from "./xs/config"

/**
 * Variant Registry for dynamic loading
 *
 * This registry allows for loading variant configurations.
 */
export const VARIANT_CONFIGS = {
	/**
	 * Generic variant - Fallback for all model types
	 * Optimized for broad compatibility and stable performance
	 */
	generic: genericConfig,

	/**
	 * Next-gen variant - Advanced models with enhanced capabilities
	 * Includes additional features like feedback loops and web fetching
	 */
	"next-gen": nextGenConfig,
	gpt5: gpt5Config,

	/**
	 * XS variant - Compact models with limited context windows
	 * Streamlined for efficiency with essential tools only
	 */
	xs: xsConfig,
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
 * @returns Variant configuration
 */
export function loadVariantConfig(variantId: VariantId) {
	return VARIANT_CONFIGS[variantId]
}

/**
 * Load all variant configurations
 * @returns A map of all variant configurations
 */
export function loadAllVariantConfigs() {
	return VARIANT_CONFIGS
}
