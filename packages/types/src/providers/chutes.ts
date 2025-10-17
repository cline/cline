import type { ModelInfo } from "../model.js"

// https://llm.chutes.ai/v1 (OpenAI compatible)
export type ChutesModelId =
	| "deepseek-ai/DeepSeek-R1-0528"
	| "deepseek-ai/DeepSeek-R1"
	| "deepseek-ai/DeepSeek-V3"
	| "deepseek-ai/DeepSeek-V3.1"
	| "deepseek-ai/DeepSeek-V3.1-Terminus"
	| "deepseek-ai/DeepSeek-V3.1-turbo"
	| "deepseek-ai/DeepSeek-V3.2-Exp"
	| "unsloth/Llama-3.3-70B-Instruct"
	| "chutesai/Llama-4-Scout-17B-16E-Instruct"
	| "unsloth/Mistral-Nemo-Instruct-2407"
	| "unsloth/gemma-3-12b-it"
	| "NousResearch/DeepHermes-3-Llama-3-8B-Preview"
	| "unsloth/gemma-3-4b-it"
	| "nvidia/Llama-3_3-Nemotron-Super-49B-v1"
	| "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1"
	| "chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8"
	| "deepseek-ai/DeepSeek-V3-Base"
	| "deepseek-ai/DeepSeek-R1-Zero"
	| "deepseek-ai/DeepSeek-V3-0324"
	| "Qwen/Qwen3-235B-A22B"
	| "Qwen/Qwen3-235B-A22B-Instruct-2507"
	| "Qwen/Qwen3-32B"
	| "Qwen/Qwen3-30B-A3B"
	| "Qwen/Qwen3-14B"
	| "Qwen/Qwen3-8B"
	| "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8"
	| "microsoft/MAI-DS-R1-FP8"
	| "tngtech/DeepSeek-R1T-Chimera"
	| "zai-org/GLM-4.5-Air"
	| "zai-org/GLM-4.5-FP8"
	| "zai-org/GLM-4.5-turbo"
	| "zai-org/GLM-4.6-FP8"
	| "moonshotai/Kimi-K2-Instruct-75k"
	| "moonshotai/Kimi-K2-Instruct-0905"
	| "Qwen/Qwen3-235B-A22B-Thinking-2507"
	| "Qwen/Qwen3-Next-80B-A3B-Instruct"
	| "Qwen/Qwen3-Next-80B-A3B-Thinking"
	| "Qwen/Qwen3-VL-235B-A22B-Thinking"

export const chutesDefaultModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1-0528"

export const chutesModels = {
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 0528 model.",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 model.",
	},
	"deepseek-ai/DeepSeek-V3": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 model.",
	},
	"deepseek-ai/DeepSeek-V3.1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3.1 model.",
	},
	"deepseek-ai/DeepSeek-V3.1-Terminus": {
		maxTokens: 163840,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.23,
		outputPrice: 0.9,
		description:
			"DeepSeek‑V3.1‑Terminus is an update to V3.1 that improves language consistency by reducing CN/EN mix‑ups and eliminating random characters, while strengthening agent capabilities with notably better Code Agent and Search Agent performance.",
	},
	"deepseek-ai/DeepSeek-V3.1-turbo": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 3.0,
		description:
			"DeepSeek-V3.1-turbo is an FP8, speculative-decoding turbo variant optimized for ultra-fast single-shot queries (~200 TPS), with outputs close to the originals and solid function calling/reasoning/structured output, priced at $1/M input and $3/M output tokens, using 2× quota per request and not intended for bulk workloads.",
	},
	"deepseek-ai/DeepSeek-V3.2-Exp": {
		maxTokens: 163840,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 0.35,
		description:
			"DeepSeek-V3.2-Exp is an experimental LLM that introduces DeepSeek Sparse Attention to improve long‑context training and inference efficiency while maintaining performance comparable to V3.1‑Terminus.",
	},
	"unsloth/Llama-3.3-70B-Instruct": {
		maxTokens: 32768, // From Groq
		contextWindow: 131072, // From Groq
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.3 70B Instruct model.",
	},
	"chutesai/Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 32768,
		contextWindow: 512000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Scout 17B Instruct model, 512K context.",
	},
	"unsloth/Mistral-Nemo-Instruct-2407": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Mistral Nemo Instruct model.",
	},
	"unsloth/gemma-3-12b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 12B IT model.",
	},
	"NousResearch/DeepHermes-3-Llama-3-8B-Preview": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nous DeepHermes 3 Llama 3 8B Preview model.",
	},
	"unsloth/gemma-3-4b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 4B IT model.",
	},
	"nvidia/Llama-3_3-Nemotron-Super-49B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.3 Nemotron Super 49B model.",
	},
	"nvidia/Llama-3_1-Nemotron-Ultra-253B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.1 Nemotron Ultra 253B model.",
	},
	"chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Maverick 17B Instruct FP8 model.",
	},
	"deepseek-ai/DeepSeek-V3-Base": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 Base model.",
	},
	"deepseek-ai/DeepSeek-R1-Zero": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 Zero model.",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 (0324) model.",
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 235B A22B Instruct 2507 model with 262K context window.",
	},
	"Qwen/Qwen3-235B-A22B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 235B A22B model.",
	},
	"Qwen/Qwen3-32B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 32B model.",
	},
	"Qwen/Qwen3-30B-A3B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 30B A3B model.",
	},
	"Qwen/Qwen3-14B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 14B model.",
	},
	"Qwen/Qwen3-8B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 8B model.",
	},
	"microsoft/MAI-DS-R1-FP8": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Microsoft MAI-DS-R1 FP8 model.",
	},
	"tngtech/DeepSeek-R1T-Chimera": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "TNGTech DeepSeek R1T Chimera model.",
	},
	"zai-org/GLM-4.5-Air": {
		maxTokens: 32768,
		contextWindow: 151329,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4.5-Air model with 151,329 token context window and 106B total parameters with 12B activated.",
	},
	"zai-org/GLM-4.5-FP8": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4.5-FP8 model with 128k token context window, optimized for agent-based applications with MoE architecture.",
	},
	"zai-org/GLM-4.5-turbo": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1,
		outputPrice: 3,
		description: "GLM-4.5-turbo model with 128K token context window, optimized for fast inference.",
	},
	"zai-org/GLM-4.6-FP8": {
		maxTokens: 32768,
		contextWindow: 202752,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4.6 introduces major upgrades over GLM-4.5, including a longer 200K-token context window for complex tasks, stronger coding performance in benchmarks and real-world tools (such as Claude Code, Cline, Roo Code, and Kilo Code), improved reasoning with tool use during inference, more capable and efficient agent integration, and refined writing that better matches human style, readability, and natural role-play scenarios.",
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 Coder 480B A35B Instruct FP8 model, optimized for coding tasks.",
	},
	"moonshotai/Kimi-K2-Instruct-75k": {
		maxTokens: 32768,
		contextWindow: 75000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1481,
		outputPrice: 0.5926,
		description: "Moonshot AI Kimi K2 Instruct model with 75k context window.",
	},
	"moonshotai/Kimi-K2-Instruct-0905": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999,
		outputPrice: 0.8001,
		description: "Moonshot AI Kimi K2 Instruct 0905 model with 256k context window.",
	},
	"Qwen/Qwen3-235B-A22B-Thinking-2507": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.077968332,
		outputPrice: 0.31202496,
		description: "Qwen3 235B A22B Thinking 2507 model with 262K context window.",
	},
	"Qwen/Qwen3-Next-80B-A3B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Fast, stable instruction-tuned model optimized for complex tasks, RAG, and tool use without thinking traces.",
	},
	"Qwen/Qwen3-Next-80B-A3B-Thinking": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Reasoning-first model with structured thinking traces for multi-step problems, math proofs, and code synthesis.",
	},
	"Qwen/Qwen3-VL-235B-A22B-Thinking": {
		maxTokens: 262144,
		contextWindow: 262144,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.16,
		outputPrice: 0.65,
		description:
			"Qwen3‑VL‑235B‑A22B‑Thinking is an open‑weight MoE vision‑language model (235B total, ~22B activated) optimized for deliberate multi‑step reasoning with strong text‑image‑video understanding and long‑context capabilities.",
	},
} as const satisfies Record<string, ModelInfo>
