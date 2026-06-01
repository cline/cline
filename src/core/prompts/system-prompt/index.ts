import { getModelCapabilityTier } from "@utils/model-capabilities"
import { isGPT5ModelFamily, isLocalModel } from "@utils/model-utils"
import { ApiProviderInfo } from "@/core/api"
import { ModelFamily } from "@/shared/prompts"
import { PromptRegistry } from "./registry/PromptRegistry"
import type { SystemPromptContext } from "./types"

export { AiHydroToolSet } from "./registry/AiHydroToolSet"
export { PromptBuilder } from "./registry/PromptBuilder"
export { PromptRegistry } from "./registry/PromptRegistry"
export * from "./templates/placeholders"
export { TemplateEngine } from "./templates/TemplateEngine"
export * from "./types"
export { VariantBuilder } from "./variants/variant-builder"
export { validateVariant } from "./variants/variant-validator"

/**
 * Extract model family from model ID (e.g., "claude-4" -> "claude")
 */
export function getModelFamily(providerInfo: ApiProviderInfo): ModelFamily {
	if (isGPT5ModelFamily(providerInfo.model.id)) {
		return ModelFamily.GPT_5
	}
	// Frontier and capable-open models (e.g. DeepSeek-v4) both get the richer
	// next-gen prompt variant.
	if (getModelCapabilityTier(providerInfo) !== "basic") {
		return ModelFamily.NEXT_GEN
	}
	if (providerInfo.customPrompt === "compact" && isLocalModel(providerInfo)) {
		return ModelFamily.XS
	}
	// Default fallback
	return ModelFamily.GENERIC
}

/**
 * Get the system prompt by id
 */
export async function getSystemPrompt(context: SystemPromptContext): Promise<string> {
	const registry = PromptRegistry.getInstance()
	return await registry.get(context)
}
