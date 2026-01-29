import { PromptRegistry } from "./registry/PromptRegistry"
import type { SystemPromptContext } from "./types"
import { systemPromptsManager } from "../SystemPromptsManager"
import { Logger } from "@/shared/services/Logger"

export { ClineToolSet } from "./registry/ClineToolSet"
export { PromptBuilder } from "./registry/PromptBuilder"
export { PromptRegistry } from "./registry/PromptRegistry"
export * from "./templates/placeholders"
export { TemplateEngine } from "./templates/TemplateEngine"
export * from "./types"
export { VariantBuilder } from "./variants/variant-builder"
export { validateVariant } from "./variants/variant-validator"

/**
 * Get the system prompt by id
 */
export async function getSystemPrompt(context: SystemPromptContext) {
	// ============================================
	// CUSTOM PROMPT OVERRIDE
	// ============================================
	const customPrompt = await systemPromptsManager.getActivePrompt()
	if (customPrompt) {
		Logger.log("Using custom system prompt")
		return { systemPrompt: customPrompt, tools: undefined }
	}

	// ============================================
	// DEFAULT SYSTEM (existing logic)
	// ============================================
	const registry = PromptRegistry.getInstance()
	const systemPrompt = await registry.get(context)
	const tools = context.enableNativeToolCalls ? registry.nativeTools : undefined
	return { systemPrompt, tools }
}
