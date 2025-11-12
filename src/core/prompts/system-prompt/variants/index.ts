/**
 * Variant Registry - Central hub for all prompt variants
 *
 * This file exports all variant configurations and provides a registry
 * for dynamic loading. Each variant is optimized for specific model families
 * and use cases.
 */

export { config as genericConfig, type GenericVariantConfig } from "./generic/config"
export { config as glmConfig, type GLMVariantConfig } from "./glm/config"
export { config as gpt5Config, type GPT5VariantConfig } from "./gpt-5/config"
export { config as hermesConfig, type HermesVariantConfig } from "./hermes/config"
export { config as nextGenConfig, type NextGenVariantConfig } from "./next-gen/config"
export { config as xsConfig, type XsVariantConfig } from "./xs/config"

import { ModelFamily } from "@/shared/prompts"
import { SystemPromptContext, VariantConfig, VariantConfigList } from "../types"
import { config as genericConfig } from "./generic/config"
import { config as glmConfig } from "./glm/config"
import { config as gpt5Config } from "./gpt-5/config"
import { config as hermesConfig } from "./hermes/config"
import { config as nextGenConfig } from "./next-gen/config"
import { config as xsConfig } from "./xs/config"

/**
 * Variant Registry for dynamic loading
 *
 * This registry allows for loading variant configurations.
 */
const VARIANT_CONFIGS: VariantConfigList = {
	/**
	 * GPT-5 variant
	 */
	[ModelFamily.GPT_5]: gpt5Config,
	/**
	 * GLM variant - Optimized for GLM-4.6 model
	 * Configured for advanced agentic coding capabilities
	 */
	[ModelFamily.GLM]: glmConfig,
	/**
	 * Hermes variant - Optimized for Hermes-4 model
	 * Configured for advanced agentic coding capabilities
	 */
	[ModelFamily.HERMES]: hermesConfig,
	/**
	 * Next-gen variant - Advanced models with enhanced capabilities
	 * Includes additional features like feedback loops and web fetching
	 */
	[ModelFamily.NEXT_GEN]: nextGenConfig,
	/**
	 * XS variant - Compact models with limited context windows
	 * Streamlined for efficiency with essential tools only
	 */
	[ModelFamily.XS]: xsConfig,
	/**
	 * Generic variant - Fallback for any model types not specifically covered above.
	 * Optimized for broad compatibility and stable performance.
	 */
	[ModelFamily.GENERIC]: genericConfig,
}

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
 * @param context - The prompt context
 * @returns Variant configuration
 */
export function loadVariantConfig(variantId: VariantId, context: SystemPromptContext) {
	return VARIANT_CONFIGS[variantId] ? VARIANT_CONFIGS[variantId](context) : undefined
}

/**
 * Load all variant configurations
 * @returns A map of all variant configurations
 */
export function loadAllVariantConfigs(context: SystemPromptContext): { [k in keyof VariantConfigList]: VariantConfig } {
	const ret: { -readonly [P in keyof VariantConfigList]: VariantConfig } = {}
	for (const [key, value] of Object.entries(VARIANT_CONFIGS)) {
		ret[key as ModelFamily] = value(context)
	}
	return ret
}
