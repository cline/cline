import type { ModelInfo } from "@cline/shared";

export const MINIMAX_FLASH_MODEL_ID = "MiniMax-M3.1-Flash";
export const MINIMAX_MAX_OUTPUT_TOKENS = 524_288;
export const MINIMAX_EFFORTS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export const MINIMAX_PROVIDER_IDS = [
	"minimax",
	"minimax-cn",
	"minimax-coding-plan",
	"minimax-cn-coding-plan",
] as const;

export function isDirectMiniMaxProvider(providerId: string): boolean {
	return MINIMAX_PROVIDER_IDS.some((id) => id === providerId);
}

export function isRetiredMiniMaxTextModel(id: string): boolean {
	return /(?:^|[/.:_-])minimax(?:ai)?[/. _-](?:m[12]\d*(?:[.\-/:_@]|$)|(?:text|vl)-01(?:[:/]|$)|m3\.1-flash-preview(?:[:/]|$))/i.test(
		id,
	);
}

/** Official direct API facts; routed model IDs and their prices stay provider-owned. */
export function normalizeMiniMaxModels(
	providerId: string,
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	const result = Object.fromEntries(
		Object.entries(models).filter(
			([id, model]) =>
				!isRetiredMiniMaxTextModel(id) ||
				(model.modalities?.output !== undefined &&
					!model.modalities.output.includes("text")),
		),
	);
	if (!isDirectMiniMaxProvider(providerId)) {
		return result;
	}

	// The Anthropic adapter supports image input, but not MiniMax video blocks.
	// https://platform.minimax.io/docs/api-reference/text-chat-anthropic.md
	const shared = {
		maxTokens: MINIMAX_MAX_OUTPUT_TOKENS,
		maxInputTokens: 1_000_000,
		contextWindow: 1_000_000,
		modalities: { input: ["text", "image"], output: ["text"] },
		capabilities: ["images", "tools", "prompt-cache", "reasoning"],
	} satisfies Partial<ModelInfo>;
	result["MiniMax-M3"] = {
		...shared,
		id: "MiniMax-M3",
		name: "MiniMax M3",
		family: "minimax-m3",
		description:
			"Standard pricing per million tokens (input/output/cache read): $0.30/$1.20/$0.06 for input <=512k; $0.60/$2.40/$0.12 above 512k. Priority costs 1.5x Standard. Cline's flat estimate uses the Standard <=512k rate.",
		reasoningOptions: [{ type: "toggle" }],
		pricing: {
			input: 0.3,
			output: 1.2,
			cacheRead: 0.06,
		},
	};
	result[MINIMAX_FLASH_MODEL_ID] = {
		...shared,
		id: MINIMAX_FLASH_MODEL_ID,
		name: "MiniMax M3.1 Flash",
		family: "minimax-m3.1",
		reasoningOptions: [{ type: "effort", values: [...MINIMAX_EFFORTS] }],
		metadata: { reasoningDefaultOn: true },
		pricing: { input: 0.15, output: 0.6, cacheRead: 0.015 },
	};
	return result;
}
