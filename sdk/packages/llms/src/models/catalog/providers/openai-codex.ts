/**
 * OpenAI Codex Models
 *
 * Reuses the OpenAI Native catalog so OpenAI Codex and OpenAI Native stay in
 * sync for model availability.
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

function removeCustomToolCapability(model: ModelInfo): ModelInfo {
	if (!model.capabilities?.includes("tools")) {
		return model;
	}

	return {
		...model,
		capabilities: model.capabilities.filter(
			(capability) => capability !== "tools",
		),
	};
}

export const OPENAI_CODEX_MODELS: Record<string, ModelInfo> =
	Object.fromEntries(
		Object.entries(getGeneratedModelsForProvider("openai")).map(
			([modelId, model]) => [modelId, removeCustomToolCapability(model)],
		),
	);

export const OPENAI_CODEX_DEFAULT_MODEL =
	Object.keys(OPENAI_CODEX_MODELS)[0] ?? "gpt-5.3-codex";

export const OPENAI_CODEX_PROVIDER: ModelCollection = {
	provider: {
		id: "openai-codex",
		name: "OpenAI Codex",
		description: "OpenAI Codex via the local Codex CLI provider",
		protocol: "openai-chat",

		baseUrl: "https://chatgpt.com/backend-api/codex",
		defaultModelId: OPENAI_CODEX_DEFAULT_MODEL,
		capabilities: ["reasoning", "oauth"],
	},
	models: OPENAI_CODEX_MODELS,
};
