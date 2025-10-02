/**
 * Conditions that must be met for an inference profile rule to apply
 */
export interface InferenceProfileConditions {
	/** Regions where this rule applies. Supports glob patterns (e.g., "us-*", "ap-*") */
	regions?: string[]
	/** Model name patterns to match. Supports substring matching */
	modelPatterns?: string[]
	/** Exact model IDs to match */
	modelIds?: string[]
}

/**
 * A rule that defines how to transform a base model ID based on conditions
 */
export interface InferenceProfileRule {
	/** The inference profile mode this rule applies to */
	mode: string
	/** Higher priority rules are evaluated first */
	priority: number
	/** Conditions that must be met for this rule to apply */
	conditions: InferenceProfileConditions
	/** Function to transform the base model ID */
	getModelId: (baseModelId: string, region: string) => string
	/** Human-readable description of this rule */
	description?: string
}

/**
 * Result of evaluating inference profile rules
 */
export interface InferenceProfileResolution {
	/** The final model ID to use */
	modelId: string
	/** The rule that was applied, if any */
	appliedRule?: InferenceProfileRule
	/** Whether this model supports global inference profiles */
	supportsGlobalProfile: boolean
}
