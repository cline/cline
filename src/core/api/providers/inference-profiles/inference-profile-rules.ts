import { bedrockModels } from "@/shared/api"
import type { InferenceProfileRule } from "./inference-profile-types"

/**
 * Inference profile rules for AWS Bedrock models
 * Rules are evaluated in priority order (higher priority first)
 * https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html
 */
export const INFERENCE_PROFILE_RULES: InferenceProfileRule[] = [
	// Global inference profiles (highest priority)
	// These provide automatic regional routing and failover
	{
		mode: "global",
		priority: 100,
		conditions: {
			modelPatterns: ["claude-sonnet-4-20250514", "claude-sonnet-4-5-20250929"],
		},
		getModelId: (baseModelId) => `global.${baseModelId}`,
		description: "Global inference profile for Claude Sonnet 4 and 4.5 models",
	},

	// JP (Japan) regional inference profiles for Claude Sonnet 4.5
	// Special inference profile available in Japan regions
	// Why Bedrock decided to make a JP region rather than sticking with APAC
	// is beyond me.
	{
		mode: "regional",
		priority: 50,
		conditions: {
			regions: ["ap-northeast-1", "ap-northeast-3"],
			modelPatterns: ["claude-sonnet-4-5"],
		},
		getModelId: (baseModelId) => `jp.${baseModelId}`,
		description: "JP inference profile for Claude Sonnet 4.5 in Japan regions",
	},

	// US regional inference profiles
	{
		mode: "regional",
		priority: 10,
		conditions: {
			regions: ["us-*"],
		},
		getModelId: (baseModelId) => `us.${baseModelId}`,
		description: "US regional inference profile",
	},

	// EU regional inference profiles
	{
		mode: "regional",
		priority: 10,
		conditions: {
			regions: ["eu-*"],
		},
		getModelId: (baseModelId) => `eu.${baseModelId}`,
		description: "EU regional inference profile",
	},

	// APAC regional inference profiles (fallback for Asia-Pacific regions)
	{
		mode: "regional",
		priority: 10,
		conditions: {
			regions: ["ap-*"],
		},
		getModelId: (baseModelId) => `apac.${baseModelId}`,
		description: "APAC regional inference profile",
	},
]

/**
 * Check if a model supports global inference profiles
 */
export function supportsGlobalInferenceProfile(modelId: string): boolean {
	return (bedrockModels as Record<string, any>)[modelId]?.supportsGlobalEndpoint ?? false
}
