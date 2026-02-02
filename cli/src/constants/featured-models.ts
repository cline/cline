/**
 * Featured models shown in the Cline model picker during onboarding
 * These are curated models that work well with Cline
 */

export interface FeaturedModel {
	id: string
	name: string
	description: string
	label: string
}

export const FEATURED_MODELS = {
	recommended: [
		{
			id: "anthropic/claude-opus-4.5",
			name: "Claude Opus 4.5",
			description: "State-of-the-art for complex coding",
			label: "Best",
		},
		{
			id: "openai/gpt-5.2-codex",
			name: "GPT 5.2 Codex",
			description: "OpenAI's latest with strong coding abilities",
			label: "New",
		},
		{
			id: "google/gemini-3-pro-preview",
			name: "Gemini 3 Pro",
			description: "1M context window for large codebases",
			label: "Trending",
		},
	] as FeaturedModel[],
	free: [
		{
			id: "moonshotai/kimi-k2.5",
			name: "Kimi K2.5",
			description: "State-of-the-art model topping benchmarks",
			label: "FREE",
		},
		{
			id: "kwaipilot/kat-coder-pro",
			name: "KAT Coder Pro",
			description: "Advanced agentic coding model",
			label: "FREE",
		},
		{
			id: "arcee-ai/trinity-large-preview:free",
			name: "Trinity Large Preview",
			description: "US built open source coding model",
			label: "FREE",
		},
	] as FeaturedModel[],
}

export function getAllFeaturedModels(): FeaturedModel[] {
	return [...FEATURED_MODELS.recommended, ...FEATURED_MODELS.free]
}
