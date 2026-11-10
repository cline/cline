import type { OpenRouterModelInfo } from "../proto/cline/models"

export interface OnboardingModelGroup {
	models: OnboardingModel[]
}

export interface OnboardingModel {
	id: string
	name: string
	score: number
	latency: number
	badge: string
	group: string
	info?: OpenRouterModelInfo
}

/**
 * The fallback list of models available to new users during the onboarding flow.
 */
export const CLINE_ONBOARDING_MODELS: OnboardingModel[] = [
	{
		group: "free",
		id: "kwaipilot/kat-coder-pro",
		name: "KwaiKAT: Kat Coder Pro",
		score: 88,
		latency: 2,
		badge: "Best",
		info: {
			contextWindow: 128_000,
			supportsImages: false,
			supportsPromptCache: false,
			inputPrice: 0,
			outputPrice: 0,
			tiers: [],
		},
	},
	{
		group: "free",
		id: "minimax/minimax-m2.5",
		name: "MiniMax: MiniMax M2.5",
		score: 90,
		latency: 2,
		badge: "New",
		info: {
			contextWindow: 192_000,
			supportsImages: false,
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
			tiers: [],
		},
	},
	{
		group: "free",
		id: "arcee-ai/trinity-large-preview:free",
		name: "Arcee AI: Trinity Large Preview",
		score: 88,
		latency: 2,
		badge: "New",
		info: {
			contextWindow: 131_000,
			supportsImages: false,
			supportsPromptCache: false,
			inputPrice: 0,
			outputPrice: 0,
			tiers: [],
		},
	},
	{
		group: "frontier",
		id: "anthropic/claude-sonnet-4.5",
		name: "Anthropic: Claude Sonnet 4.5",
		badge: "",
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
		id: "google/gemini-3.1-pro-preview",
		name: "Gemini 3.1 Pro",
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
]
