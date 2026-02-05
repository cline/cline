/**
 * Featured models shown in the Cline model picker during onboarding
 * These are curated models that work well with Cline
 */

export interface FeaturedModel {
	id: string
	name: string
	description: string
	labels: string[]
}

export const FEATURED_MODELS = {
	recommended: [
		{
			id: "anthropic/claude-opus-4.6",
			name: "Claude Opus 4.6",
			description: "State-of-the-art for complex coding",
			labels: ["BEST"],
		},
		{
			id: "openai/gpt-5.2-codex",
			name: "GPT 5.2 Codex",
			description: "OpenAI's latest with strong coding abilities",
			labels: ["NEW"],
		},
		{
			id: "google/gemini-3-pro-preview",
			name: "Gemini 3 Pro",
			description: "1M context window for large codebases",
			labels: ["TRENDING"],
		},
	] as FeaturedModel[],
	free: [
		{
			id: "minimax/minimax-m2.1",
			name: "MiniMax M2.1",
			description: "Exceptional Multi-Programming Language Capabilities",
			labels: ["FREE"],
		},
		{
			id: "moonshotai/kimi-k2.5",
			name: "Kimi K2.5",
			description: "State-of-the-art model topping benchmarks",
			labels: ["FREE"],
		},
		{
			id: "kwaipilot/kat-coder-pro",
			name: "KAT Coder Pro",
			description: "Advanced agentic coding model",
			labels: ["FREE"],
		},
		{
			id: "arcee-ai/trinity-large-preview:free",
			name: "Trinity Large Preview",
			description: "US built open source coding model",
			labels: ["FREE"],
		},
	] as FeaturedModel[],
}

export function getAllFeaturedModels(): FeaturedModel[] {
	return [...FEATURED_MODELS.recommended, ...FEATURED_MODELS.free]
}
