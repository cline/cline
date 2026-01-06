import type { OnboardingModel } from "../proto/cline/state"

/**
 * The list of models available to new users during the onboarding flow.
 * NOTE: Can be overridden by feature flag onboarding models payload.
 */
export const CLINE_ONBOARDING_MODELS: OnboardingModel[] = [
	{
		group: "free",
		id: "x-ai/grok-code-fast-1",
		name: "xAI: Grok Code Fast 1",
		score: 90,
		latency: 1,
		badge: "Best",
		info: {
			contextWindow: 256_000,
			supportsImages: true,
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
			tiers: [],
		},
	},
	{
		group: "frontier",
		id: "anthropic/claude-sonnet-4.5",
		name: "Anthropic: Claude Sonnet 4.5",
		badge: "Best",
		score: 97,
		latency: 3,
		info: {
			contextWindow: 200_000,
			supportsImages: true,
			supportsPromptCache: true,
			inputPrice: 3.0,
			outputPrice: 15.0,
			tiers: [],
		},
	},
	{
		group: "frontier",
		id: "google/gemini-3-pro-preview",
		name: "Gemini 3.0 Pro",
		badge: "Preview",
		score: 97,
		latency: 3,
		info: {
			contextWindow: 1_048_576,
			supportsImages: true,
			supportsPromptCache: true,
			inputPrice: 4.0,
			outputPrice: 18.0,
			tiers: [],
		},
	},
	{
		group: "frontier",
		id: "openai/gpt-5-codex",
		name: "OpenAI: GPT-5 Codex",
		badge: "Best",
		score: 97,
		latency: 7,
		info: {
			contextWindow: 400_000,
			supportsImages: true,
			supportsPromptCache: true,
			inputPrice: 1.25,
			outputPrice: 10.0,
			tiers: [],
		},
	},
	{
		group: "frontier",
		id: "openai/gpt-5.2",
		name: "OpenAI: GPT-5.2",
		badge: "New",
		score: 97,
		latency: 3,
		info: {
			contextWindow: 272_000,
			supportsImages: true,
			supportsPromptCache: true,
			inputPrice: 1.75,
			outputPrice: 14.0,
			tiers: [],
		},
	},
	{
		group: "open source",
		id: "z-ai/glm-4.6:exacto",
		name: "Z.AI: GLM 4.6 (exacto)",
		badge: "Trending",
		score: 90,
		latency: 2,
		info: {
			contextWindow: 202_752,
			supportsImages: false,
			supportsPromptCache: false,
			inputPrice: 0.6,
			outputPrice: 2.5,
			tiers: [],
		},
	},
]
