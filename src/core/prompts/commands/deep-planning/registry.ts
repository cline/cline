import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import type { DeepPlanningVariant, DeepPlanningRegistry as IDeepPlanningRegistry } from "./types"
import {
	createAnthropicVariant,
	createGemini3Variant,
	createGeminiVariant,
	createGenericVariant,
	createGPT51Variant,
} from "./variants"

/**
 * Singleton registry for managing deep-planning prompt variants
 * Selects appropriate variant based on model family detection
 */
class DeepPlanningRegistry implements IDeepPlanningRegistry {
	private static instance: DeepPlanningRegistry | null = null
	private variants: Map<string, DeepPlanningVariant> = new Map()
	private genericVariant: DeepPlanningVariant

	private constructor() {
		// Initialize all variants
		this.registerVariant(createAnthropicVariant())
		this.registerVariant(createGeminiVariant())
		this.registerVariant(createGemini3Variant())
		this.registerVariant(createGPT51Variant())

		// Generic variant must be registered last as fallback
		const genericVariant = createGenericVariant()
		this.registerVariant(genericVariant)
		this.genericVariant = genericVariant
	}

	/**
	 * Get the singleton instance of the registry
	 */
	public static getInstance(): DeepPlanningRegistry {
		if (!DeepPlanningRegistry.instance) {
			DeepPlanningRegistry.instance = new DeepPlanningRegistry()
		}
		return DeepPlanningRegistry.instance
	}

	/**
	 * Register a new variant in the registry
	 */
	public register(variant: DeepPlanningVariant): void {
		this.registerVariant(variant)
	}

	/**
	 * Internal method to register a variant
	 */
	private registerVariant(variant: DeepPlanningVariant): void {
		this.variants.set(variant.id, variant)
	}

	/**
	 * Get the appropriate variant based on the system prompt context
	 * Uses matcher functions to determine which variant to use
	 * Falls back to generic variant if no match or on error
	 */
	public get(context: SystemPromptContext): DeepPlanningVariant {
		try {
			// Try each variant's matcher function (except generic which is last)
			for (const variant of this.variants.values()) {
				// Skip generic variant in iteration (it's the fallback)
				if (variant.id === "generic") {
					continue
				}

				// Test if this variant matches the context
				if (variant.matcher(context)) {
					return variant
				}
			}

			// No match found, return generic variant
			return this.genericVariant
		} catch (error) {
			// On any error, safely fall back to generic variant
			console.warn("Error selecting deep-planning variant, falling back to generic:", error)
			return this.genericVariant
		}
	}

	/**
	 * Get all registered variants
	 */
	public getAll(): DeepPlanningVariant[] {
		return Array.from(this.variants.values())
	}
}

/**
 * Export singleton instance getter
 */
export function getDeepPlanningRegistry(): DeepPlanningRegistry {
	return DeepPlanningRegistry.getInstance()
}
