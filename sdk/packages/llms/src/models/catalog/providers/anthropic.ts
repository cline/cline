/**
 * Anthropic Models
 *
 * Model definitions for Anthropic's Claude family of models.
 * https://docs.anthropic.com/en/docs/about-claude/models
 */

import { getGeneratedModelsForProvider } from "../../generated-access";
import type { ModelCollection, ModelInfo } from "../../types/index";

/**
 * Anthropic model definitions
 */
export const ANTHROPIC_MODELS = getGeneratedModelsForProvider("anthropic");

/**
 * Default Anthropic model ID
 */
export const ANTHROPIC_DEFAULT_MODEL =
	Object.keys(ANTHROPIC_MODELS)[0] ?? "claude-sonnet-4-6";

/**
 * Anthropic provider information
 */
export const ANTHROPIC_PROVIDER: ModelCollection = {
	provider: {
		id: "anthropic",
		name: "Anthropic",
		description: "Creator of Claude, the AI assistant",
		protocol: "anthropic",
		baseUrl: "https://api.anthropic.com",
		defaultModelId: ANTHROPIC_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
		env: ["ANTHROPIC_API_KEY"],
		client: "anthropic",
	},
	models: ANTHROPIC_MODELS,
};

/**
 * Get all active Anthropic models
 */
export function getActiveAnthropicModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(ANTHROPIC_MODELS).filter(
			([, info]) =>
				!info.status || info.status === "active" || info.status === "preview",
		),
	);
}

/**
 * Get Anthropic models with reasoning/thinking support
 */
export function getAnthropicReasoningModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(ANTHROPIC_MODELS).filter(
			([, info]) => info.thinkingConfig !== undefined,
		),
	);
}
