import type { ModelInfo } from "@shared/api"
import { NEW_USER_TYPE } from "./data-steps"

export interface OnboardingModelOption extends ModelInfo {
	id: string
	name?: string
	description?: string
	badge?: string
	supported_parameters?: string[]
	score?: number
	speed?: string
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
					description:
						"Grok Code Fast 1 is a speedy and economical reasoning model that excels at agentic coding. With reasoning traces visible in the response, developers can steer Grok Code for high-quality work flows.",
					score: 90,
					speed: "Fast",
					badge: "Best",
					contextWindow: 256000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 0,
					outputPrice: 0,
				},
				{
					id: "minimax/minimax-m1",
					name: "MiniMax: MiniMax M1",
					description:
						'MiniMax-M1 is a large-scale, open-weight reasoning model designed for extended context and high-efficiency inference. It leverages a hybrid Mixture-of-Experts (MoE) architecture paired with a custom "lightning attention" mechanism, allowing it to process long sequences—up to 1 million tokens—while maintaining competitive FLOP efficiency. With 456 billion total parameters and 45.9B active per token, this variant is optimized for complex, multi-step reasoning tasks.\n\nTrained via a custom reinforcement learning pipeline (CISPO), M1 excels in long-context understanding, software engineering, agentic tool use, and mathematical reasoning. Benchmarks show strong performance across FullStackBench, SWE-bench, MATH, GPQA, and TAU-Bench, often outperforming other open models like DeepSeek R1 and Qwen3-235B.',
					badge: "Trending",
					score: 90,
					speed: "Fast",
					contextWindow: 1000000,
					supportsImages: false,
					supportsPromptCache: false,
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
					description:
						"Claude Sonnet 4.5 is Anthropic’s most advanced Sonnet model to date, optimized for real-world agents and coding workflows. It delivers state-of-the-art performance on coding benchmarks such as SWE-bench Verified, with improvements across system design, code security, and specification adherence. The model is designed for extended autonomous operation, maintaining task continuity across sessions and providing fact-based progress tracking. Sonnet 4.5 also introduces stronger agentic capabilities, including improved tool orchestration, speculative parallel execution, and more efficient context and memory management. With enhanced context tracking and awareness of token usage across tool calls, it is particularly well-suited for multi-context and long-running workflows. Use cases span software engineering, cybersecurity, financial analysis, research agents, and other domains requiring sustained reasoning and tool use.",
					badge: "Best",
					score: 97,
					speed: "Fast",
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3.0,
					outputPrice: 15.0,
				},
				{
					id: "openai/gpt-5-codex",
					name: "OpenAI: GPT-5 Codex",
					description:
						"GPT-5-Codex is a specialized version of GPT-5 optimized for software engineering and coding workflows. It is designed for both interactive development sessions and long, independent execution of complex engineering tasks. The model supports building projects from scratch, feature development, debugging, large-scale refactoring, and code review. Compared to GPT-5, Codex is more steerable, adheres closely to developer instructions, and produces cleaner, higher-quality code outputs. Reasoning effort can be adjusted with the `reasoning.effort` parameter. Read the [docs here](https://openrouter.ai/docs/use-cases/reasoning-tokens#reasoning-effort-level)\n\nCodex integrates into developer environments including the CLI, IDE extensions, GitHub, and cloud tasks. It adapts reasoning effort dynamically—providing fast responses for small tasks while sustaining extended multi-hour runs for large projects. The model is trained to perform structured code reviews, catching critical flaws by reasoning over dependencies and validating behavior against tests. It also supports multimodal inputs such as images or screenshots for UI development and integrates tool use for search, dependency installation, and environment setup. Codex is intended specifically for agentic coding applications.",
					badge: "Best",
					score: 97,
					speed: "Slow",
					contextWindow: 400000,
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
					description:
						"Compared with GLM-4.5, this generation brings several key improvements:\n\nLonger context window: The context window has been expanded from 128K to 200K tokens, enabling the model to handle more complex agentic tasks.\nSuperior coding performance: The model achieves higher scores on code benchmarks and demonstrates better real-world performance in applications such as Claude Code、Cline、Roo Code and Kilo Code, including improvements in generating visually polished front-end pages.\nAdvanced reasoning: GLM-4.6 shows a clear improvement in reasoning performance and supports tool use during inference, leading to stronger overall capability.\nMore capable agents: GLM-4.6 exhibits stronger performance in tool using and search-based agents, and integrates more effectively within agent frameworks.\nRefined writing: Better aligns with human preferences in style and readability, and performs more naturally in role-playing scenarios.",
					badge: "Trending",
					score: 90,
					speed: "Average",
					contextWindow: 202752,
					supportsImages: false,
					supportsPromptCache: false,
					inputPrice: 0.6,
					outputPrice: 2.5,
				},
				{
					id: "moonshotai/kimi-dev-72b:free",
					name: "MoonshotAI: Kimi Dev 72B (free)",
					description:
						"Kimi-Dev-72B is an open-source large language model fine-tuned for software engineering and issue resolution tasks. Based on Qwen2.5-72B, it is optimized using large-scale reinforcement learning that applies code patches in real repositories and validates them via full test suite execution—rewarding only correct, robust completions. The model achieves 60.4% on SWE-bench Verified, setting a new benchmark among open-source models for software bug fixing and code reasoning.",
					badge: "Free",
					score: 90,
					speed: "Fast",
					contextWindow: 131072,
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
