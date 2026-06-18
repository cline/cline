import type { ModelInfo } from "../catalog/types";

/**
 * Static catalog of Turkey-hosted LLMTR models.
 *
 * LLMTR (https://llmtr.com) is an OpenAI-compatible AI gateway that exposes
 * Turkey-hosted models alongside global providers. The Turkey-hosted models
 * are listed here so they surface first in pickers; the full live catalog
 * (including proxied global models) is merged in from the authenticated
 * `/v1/models` endpoint at runtime.
 */
export function buildLlmtrModels(): Record<string, ModelInfo> {
	return {
		"llmtr/sincap": {
			id: "llmtr/sincap",
			name: "Sincap",
			description:
				"Turkey-hosted general-purpose chat model with a large context window.",
			contextWindow: 128_000,
			maxInputTokens: 128_000,
			capabilities: ["streaming", "tools", "temperature"],
			pricing: { input: 0, output: 0 },
			status: "active",
		},
		"llmtr/gemma-4": {
			id: "llmtr/gemma-4",
			name: "Gemma 4",
			description: "Turkey-hosted Gemma 4 chat model.",
			contextWindow: 32_768,
			maxInputTokens: 32_768,
			capabilities: ["streaming", "tools", "temperature"],
			pricing: { input: 5, output: 10 },
			status: "active",
		},
		"llmtr/qwen3-6-35b": {
			id: "llmtr/qwen3-6-35b",
			name: "Qwen 3.6 35B-A3B",
			description:
				"Turkey-hosted Qwen 3.6 MoE model tuned for code and logic tasks.",
			contextWindow: 16_384,
			maxInputTokens: 16_384,
			capabilities: ["streaming", "tools", "temperature"],
			pricing: { input: 5, output: 10 },
			status: "active",
		},
		"llmtr/trendyol-7b": {
			id: "llmtr/trendyol-7b",
			name: "Trendyol 7B",
			description:
				"Turkey-hosted Turkish-focused chat model based on Qwen 2.5 7B.",
			contextWindow: 32_768,
			maxInputTokens: 32_768,
			capabilities: ["streaming", "tools", "temperature"],
			pricing: { input: 0, output: 0 },
			status: "active",
		},
		"llmtr/magibu-11b-v8": {
			id: "llmtr/magibu-11b-v8",
			name: "Magibu 11B v8",
			description: "Turkey-hosted Turkish-focused assistant model.",
			contextWindow: 8_192,
			maxInputTokens: 8_192,
			capabilities: ["streaming", "tools", "temperature"],
			pricing: { input: 0, output: 0 },
			status: "active",
		},
		"llmtr/medgemma-4b": {
			id: "llmtr/medgemma-4b",
			name: "MedGemma 4B",
			description:
				"Turkey-hosted medical-domain Gemma variant with image understanding.",
			contextWindow: 8_192,
			maxInputTokens: 8_192,
			capabilities: ["streaming", "tools", "temperature", "images"],
			pricing: { input: 3, output: 5 },
			status: "active",
		},
	};
}
