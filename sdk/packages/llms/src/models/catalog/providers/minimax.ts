/**
 * MiniMax Provider
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

const DEFAULT_MINIMAX_MODEL_ID = "MiniMax-M2.5";

export const MINIMAX_MODELS: Record<string, ModelInfo> = {
	[DEFAULT_MINIMAX_MODEL_ID]: {
		id: DEFAULT_MINIMAX_MODEL_ID,
		name: "MiniMax M2.5",
		capabilities: ["streaming", "tools", "reasoning", "prompt-cache"],
	},
	...getGeneratedModelsForProvider("minimax"),
};

export const MINIMAX_DEFAULT_MODEL =
	Object.keys(MINIMAX_MODELS)[0] ?? DEFAULT_MINIMAX_MODEL_ID;

export const MINIMAX_PROVIDER: ModelCollection = {
	provider: {
		id: "minimax",
		name: "MiniMax",
		description: "MiniMax models via Anthropic-compatible API",
		protocol: "anthropic",
		baseUrl: "https://api.minimax.io/anthropic",
		defaultModelId: MINIMAX_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: ["MINIMAX_API_KEY"],
	},
	models: MINIMAX_MODELS,
};
