import type { ModelInfo } from "@shared/api"
import { NEW_USER_TYPE } from "./data-steps"

export interface OnboardingModelOption extends ModelInfo {
	id: string
	name?: string
	badge?: string
	supported_parameters?: string[]
	score?: number
	latency?: number
}

type ModelGroup = {
	group: string
	models: OnboardingModelOption[]
}

export const ONBOARDING_MODEL_SELECTIONS: Record<"free" | "power", ModelGroup[]> = {
	[NEW_USER_TYPE.FREE]: [
		{
			group: "free",
			models: [
				{
					id: "x-ai/grok-code-fast-1",
					name: "xAI: Grok Code Fast 1",
					score: 90,
					latency: 1,
					badge: "Best",
					contextWindow: 256_000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 0,
					outputPrice: 0,
				},
			],
		},
	],
	[NEW_USER_TYPE.POWER]: [
		{
			group: "frontier",
			models: [
				{
					id: "anthropic/claude-sonnet-4.5",
					name: "Anthropic: Claude Sonnet 4.5",
					badge: "Best",
					score: 97,
					latency: 3,
					contextWindow: 200_000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3.0,
					outputPrice: 15.0,
				},
				{
					id: "openai/gpt-5-codex",
					name: "OpenAI: GPT-5 Codex",
					badge: "Best",
					score: 97,
					latency: 7,
					contextWindow: 400_000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 1.25,
					outputPrice: 10.0,
				},
				{
					id: "openai/gpt-5.1",
					name: "OpenAI: GPT-5.1",
					badge: "New",
					score: 97,
					latency: 3,
					contextWindow: 272_000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 1.25,
					outputPrice: 10.0,
				},
			],
		},
		{
			group: "open source",
			models: [
				{
					id: "z-ai/glm-4.6:exacto",
					name: "Z.AI: GLM 4.6 (exacto)",
					badge: "Trending",
					score: 90,
					latency: 2,
					contextWindow: 202_752,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.6,
					outputPrice: 2.5,
				},
				{
					id: "moonshotai/kimi-dev-72b:free",
					name: "MoonshotAI: Kimi Dev 72B (free)",
					badge: "Free",
					score: 90,
					latency: 1,
					contextWindow: 131_072,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0,
					outputPrice: 0,
				},
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

export function getSpeedLabel(latency?: number): string {
	if (!latency) {
		return "Average"
	}
	if (latency < 1) {
		return "Instant"
	}
	if (latency < 2) {
		return "Fast"
	}
	if (latency > 5) {
		return "Slow"
	}

	return "Average"
}
