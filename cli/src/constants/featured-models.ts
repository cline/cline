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

export const FEATURED_MODELS: { recommended: FeaturedModel[]; free: FeaturedModel[] } = {
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
	],
	free: [
		{
			id: "minimax/minimax-m2.5",
			name: "MiniMax M2.5",
			description: "MiniMax-M2.5 is a lightweight, state-of-the-art LLM optimized for coding and agentic workflows",
			labels: ["FREE"],
		},
		{
			id: "z-ai/glm-5",
			name: "Z-AI GLM5",
			description: "Z.AI's latest GLM 5 model with strong coding and agent performance",
			labels: ["FREE"],
		},
		{
			id: "kwaipilot/kat-coder-pro",
			name: "KAT Coder Pro",
			description: "KwaiKAT's most advanced agentic coding model in the KAT-Coder series",
			labels: ["FREE"],
		},
		{
			id: "arcee-ai/trinity-large-preview:free",
			name: "Trinity Large Preview",
			description: "Arcee AI's advanced large preview model in the Trinity series",
			labels: ["FREE"],
		},
	],
}

export function getAllFeaturedModels(): FeaturedModel[] {
	return [...FEATURED_MODELS.recommended, ...FEATURED_MODELS.free]
}
