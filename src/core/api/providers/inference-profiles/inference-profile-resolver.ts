import { INFERENCE_PROFILE_RULES, supportsGlobalInferenceProfile } from "./inference-profile-rules"
import type { InferenceProfileConditions, InferenceProfileResolution } from "./inference-profile-types"

/**
 * Resolves AWS Bedrock inference profiles based on model, region, and mode
 */
export class InferenceProfileResolver {
	/**
	 * Resolve the appropriate model ID based on inference profile configuration
	 */
	static resolveModelId(
		baseModelId: string,
		region: string,
		mode: string,
		customSelected: boolean = false,
	): InferenceProfileResolution {
		// Custom models always use none access (no inference profile)
		if (customSelected) {
			return {
				modelId: baseModelId,
				supportsGlobalProfile: false,
			}
		}

		// none mode uses base model ID directly
		if (mode === "none") {
			return {
				modelId: baseModelId,
				supportsGlobalProfile: supportsGlobalInferenceProfile(baseModelId),
			}
		}

		// Find matching rule by priority for the specified mode
		const applicableRules = INFERENCE_PROFILE_RULES.filter((rule) => rule.mode === mode).sort(
			(a, b) => b.priority - a.priority,
		) // Higher priority first

		const matchingRule = applicableRules.find((rule) =>
			InferenceProfileResolver.matchesConditions(rule.conditions, baseModelId, region),
		)

		if (matchingRule) {
			return {
				modelId: matchingRule.getModelId(baseModelId, region),
				appliedRule: matchingRule,
				supportsGlobalProfile: supportsGlobalInferenceProfile(baseModelId),
			}
		}

		// No matching rule found, fallback to base model ID
		return {
			modelId: baseModelId,
			supportsGlobalProfile: supportsGlobalInferenceProfile(baseModelId),
		}
	}

	/**
	 * Get backwards compatible inference profile mode from legacy settings
	 */
	static getInferenceProfileMode(awsInferenceStrategy?: string, awsUseCrossRegionInference?: boolean): string {
		// New field takes precedence
		if (awsInferenceStrategy) {
			return awsInferenceStrategy
		}

		// Backwards compatibility with legacy field
		if (awsUseCrossRegionInference === true) {
			return "regional"
		}

		// Default to none
		return "none"
	}

	/**
	 * Check if the given conditions match the model and region
	 */
	private static matchesConditions(conditions: InferenceProfileConditions, baseModelId: string, region: string): boolean {
		// Check region conditions
		if (conditions.regions && conditions.regions.length > 0) {
			const regionMatches = conditions.regions.some((regionPattern) =>
				InferenceProfileResolver.matchesPattern(region, regionPattern),
			)
			if (!regionMatches) {
				return false
			}
		}

		// Check model pattern conditions
		if (conditions.modelPatterns && conditions.modelPatterns.length > 0) {
			const modelPatternMatches = conditions.modelPatterns.some((pattern) => baseModelId.includes(pattern))
			if (!modelPatternMatches) {
				return false
			}
		}

		// Check exact model ID conditions
		if (conditions.modelIds && conditions.modelIds.length > 0) {
			const exactModelMatches = conditions.modelIds.includes(baseModelId)
			if (!exactModelMatches) {
				return false
			}
		}

		return true
	}

	/**
	 * Match a string against a pattern that supports basic glob-style wildcards
	 */
	private static matchesPattern(value: string, pattern: string): boolean {
		if (pattern === value) {
			return true
		}

		// Support glob-style wildcards (e.g., "us-*", "ap-*")
		if (pattern.includes("*")) {
			const regexPattern = pattern
				.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
				.replace(/\\\*/g, ".*") // Convert * to .*
			const regex = new RegExp(`^${regexPattern}$`)
			return regex.test(value)
		}

		return false
	}

	/**
	 * Get available inference profile modes for a given model
	 */
	static getAvailableModesForModel(baseModelId: string): string[] {
		const modes: string[] = ["none", "regional"]

		// Add global mode if the model supports it
		if (supportsGlobalInferenceProfile(baseModelId)) {
			modes.push("global")
		}

		return modes
	}

	/**
	 * Get a human-readable description of what each inference profile mode does
	 */
	static getModeDescription(mode: string): string {
		switch (mode) {
			case "none":
				return "Use the model directly in the selected region"
			case "regional":
				return "Route requests across regions (us., eu., apac., jp. prefixes)"
			case "global":
				return "Automatic regional routing and failover (Sonnet 4/4.5 only)"
			default:
				return "Unknown inference profile mode"
		}
	}
}
