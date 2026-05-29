import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"

/**
 * Configuration for a deep-planning prompt variant
 */
export interface DeepPlanningVariant {
	/** Unique identifier for this variant (e.g., "anthropic", "gemini", "gpt-5", "generic") */
	id: string

	/** Human-readable description of this variant */
	description: string

	/** The model family this variant is designed for */
	family: string

	/** Version number for this variant */
	version: number

	/** Matcher function to determine if this variant should be used */
	matcher: (context: SystemPromptContext) => boolean

	/** The complete prompt template string */
	template: string
}

/**
 * Registry for deep-planning prompt variants
 */
export interface DeepPlanningRegistry {
	/** Get the appropriate variant based on context */
	get(context: SystemPromptContext): DeepPlanningVariant

	/** Register a new variant */
	register(variant: DeepPlanningVariant): void

	/** Get all registered variants */
	getAll(): DeepPlanningVariant[]
}
