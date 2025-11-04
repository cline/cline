import type { ModelInfo } from "@shared/api"
import { cerebrasModels, openAiNativeModels, openRouterDefaultModelInfo } from "@shared/api"
import { NEW_USER_TYPE } from "./data-steps"

export interface OnboardingModelOption extends ModelInfo {
	id: string
	name?: string
	badge?: string
	supported_parameters?: string[]
	score?: number
	speed?: string
}

type ModelGroup = {
	group: string
	models: OnboardingModelOption[]
}

/**
 * Onboarding-specific metadata for models
 * Contains only UI-specific properties (score, speed, badge, display name)
 * Model capabilities (contextWindow, prices, etc.) are pulled from api.ts
 */
interface OnboardingModelMetadata {
	/** Model ID used in OpenRouter or provider-specific format */
	id: string
	/** Display name for the onboarding UI */
	name: string
	/** Badge to display (e.g., "Best", "Trending", "Free") */
	badge?: string
	/** Performance score (0-100) */
	score: number
	/** Speed indicator ("Fast", "Average", "Slow") */
	speed: "Fast" | "Average" | "Slow"
}

/**
 * Creates an OnboardingModelOption by merging source model data with metadata
 */
function createOnboardingModel(metadata: OnboardingModelMetadata, sourceModel: ModelInfo): OnboardingModelOption {
	return {
		...sourceModel,
		...metadata,
	}
}

/**
 * Model metadata definitions - only contains onboarding-specific fields
 * Actual model capabilities come from the source models in api.ts
 */
const ONBOARDING_MODEL_METADATA = {
	free: {
		"x-ai/grok-code-fast-1": {
			id: "x-ai/grok-code-fast-1",
			name: "xAI: Grok Code Fast 1",
			badge: "Best",
			score: 90,
			speed: "Fast" as const,
		},
		"minimax/minimax-m1": {
			id: "minimax/minimax-m1",
			name: "MiniMax: MiniMax M1",
			badge: "Trending",
			score: 90,
			speed: "Fast" as const,
		},
	},
	power: {
		"anthropic/claude-sonnet-4.5": {
			id: "anthropic/claude-sonnet-4.5",
			name: "Anthropic: Claude Sonnet 4.5",
			badge: "Best",
			score: 97,
			speed: "Fast" as const,
		},
		"openai/gpt-5-codex": {
			id: "openai/gpt-5-codex",
			name: "OpenAI: GPT-5 Codex",
			badge: "Best",
			score: 97,
			speed: "Slow" as const,
		},
		"z-ai/glm-4.6:exacto": {
			id: "z-ai/glm-4.6:exacto",
			name: "Z.AI: GLM 4.6 (exacto)",
			badge: "Trending",
			score: 90,
			speed: "Average" as const,
		},
		"moonshotai/kimi-dev-72b:free": {
			id: "moonshotai/kimi-dev-72b:free",
			name: "MoonshotAI: Kimi Dev 72B (free)",
			badge: "Free",
			score: 90,
			speed: "Fast" as const,
		},
	},
} as const

/**
 * Maps model IDs to their source definitions in api.ts
 * This creates the single source of truth for model capabilities
 */
const MODEL_SOURCE_MAP: Record<string, ModelInfo> = {
	// Free tier models
	"x-ai/grok-code-fast-1": {
		// Placeholder - this model doesn't exist in api.ts yet
		// Using xAI grok-4-fast-reasoning as reference
		maxTokens: 30000,
		contextWindow: 2000000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
	"minimax/minimax-m1": {
		// Placeholder - this model doesn't exist in api.ts yet
		// Using MiniMax-M2 as reference
		maxTokens: 128000,
		contextWindow: 1000000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},

	// Power tier models - reference actual models from api.ts
	"anthropic/claude-sonnet-4.5": openRouterDefaultModelInfo,
	"openai/gpt-5-codex": {
		// Using GPT-5 from openAiNativeModels as base
		...openAiNativeModels["gpt-5-2025-08-07"],
		// Override with codex-specific values if different
		contextWindow: 400000,
	},
	"z-ai/glm-4.6:exacto": cerebrasModels["zai-glm-4.6"],
	"moonshotai/kimi-dev-72b:free": {
		// Placeholder - using estimated values
		maxTokens: 16384,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
}

export const ONBOARDING_MODEL_SELECTIONS: Record<"free" | "power", ModelGroup[]> = {
	[NEW_USER_TYPE.FREE]: [
		{
			group: "free",
			models: [
				createOnboardingModel(
					ONBOARDING_MODEL_METADATA.free["x-ai/grok-code-fast-1"],
					MODEL_SOURCE_MAP["x-ai/grok-code-fast-1"],
				),
				createOnboardingModel(
					ONBOARDING_MODEL_METADATA.free["minimax/minimax-m1"],
					MODEL_SOURCE_MAP["minimax/minimax-m1"],
				),
			],
		},
	],
	[NEW_USER_TYPE.POWER]: [
		{
			group: "frontier",
			models: [
				createOnboardingModel(
					ONBOARDING_MODEL_METADATA.power["anthropic/claude-sonnet-4.5"],
					MODEL_SOURCE_MAP["anthropic/claude-sonnet-4.5"],
				),
				createOnboardingModel(
					ONBOARDING_MODEL_METADATA.power["openai/gpt-5-codex"],
					MODEL_SOURCE_MAP["openai/gpt-5-codex"],
				),
			],
		},
		{
			group: "open source",
			models: [
				createOnboardingModel(
					ONBOARDING_MODEL_METADATA.power["z-ai/glm-4.6:exacto"],
					MODEL_SOURCE_MAP["z-ai/glm-4.6:exacto"],
				),
				createOnboardingModel(
					ONBOARDING_MODEL_METADATA.power["moonshotai/kimi-dev-72b:free"],
					MODEL_SOURCE_MAP["moonshotai/kimi-dev-72b:free"],
				),
			],
		},
	],
}

export function getPriceRange(modelInfo: ModelInfo): string {
	const prompt = Number(modelInfo.inputPrice ?? 0)
	const completion = Number(modelInfo.outputPrice ?? 0)
	const cost = prompt + completion
	if (cost === 0) {
		return "Free"
	}
	if (cost < 10) {
		return "$"
	}
	if (cost > 50) {
		return "$$$"
	}
	return "$$"
}

export function getOverviewLabel(overview: number): string {
	if (overview >= 95) {
		return "Top Performer"
	}
	if (overview >= 80) {
		return "Great"
	}
	if (overview >= 60) {
		return "Good"
	}
	if (overview >= 50) {
		return "Average"
	}
	return "Below Average"
}

export function getCapabilities(modelInfo: ModelInfo): string[] {
	const capabilities = new Set<string>()
	if (modelInfo.supportsImages) {
		capabilities.add("Images")
	}
	if (modelInfo.supportsPromptCache) {
		capabilities.add("Prompt Cache")
	}
	capabilities.add("Tools")
	return Array.from(capabilities)
}
