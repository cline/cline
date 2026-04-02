/**
 * OpenCode Provider
 *
 * OpenCode SDK wrapper provider that supports provider/model IDs
 * like "openai/gpt-5.3-codex" and "anthropic/claude-sonnet-4-5-20250929".
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

export const OPENCODE_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("opencode");

export const OPENCODE_DEFAULT_MODEL =
	Object.keys(OPENCODE_MODELS)[0] ?? "openai/gpt-5.3-codex";

export const OPENCODE_PROVIDER: ModelCollection = {
	provider: {
		id: "opencode",
		name: "OpenCode",
		description: "OpenCode SDK multi-provider runtime",
		protocol: "openai-chat",
		baseUrl: "",
		defaultModelId: OPENCODE_DEFAULT_MODEL,
		capabilities: ["reasoning", "oauth"],
		client: "ai-sdk-community",
	},
	models: OPENCODE_MODELS,
};
