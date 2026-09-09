import type { ModelInfo } from "../catalog/types";

/** Fallback until the generated catalog includes Astra. Catalog entries win.
 * https://developers.openai.com/api/docs/models/gpt-6-astra
 */
export function astraFallback(): ModelInfo {
	return {
		id: "gpt-6-astra",
		name: "GPT-6 Astra",
		contextWindow: 1_050_000,
		// Reserve the maximum output budget within the shared context window.
		maxInputTokens: 1_050_000 - 128_000,
		maxTokens: 128_000,
		capabilities: [
			"images",
			"tools",
			"reasoning",
			"structured_output",
			"prompt-cache",
		],
		family: "gpt-astra",
		reasoningOptions: [
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		],
		metadata: {
			source: "https://developers.openai.com/api/docs/models/gpt-6-astra",
		},
	};
}

export function withAstra(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.hasOwn(models, "gpt-6-astra")
		? models
		: { ...models, "gpt-6-astra": astraFallback() };
}
