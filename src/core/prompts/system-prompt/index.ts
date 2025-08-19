import { PromptRegistry } from "./registry/PromptRegistry"
import type { SystemPromptContext } from "./types"

export { PromptBuilder } from "./registry/PromptBuilder"
export { PromptRegistry } from "./registry/PromptRegistry"
export * from "./templates/placeholders"
export { TemplateEngine } from "./templates/TemplateEngine"
export * from "./types"

// Convenience function for getting a prompt
export async function getPrompt(modelId: string, context: SystemPromptContext): Promise<string> {
	const registry = PromptRegistry.getInstance()
	return await registry.get(modelId, context)
}

// Convenience function for getting a prompt by version
export async function getPromptVersion(modelId: string, version: number, context: SystemPromptContext): Promise<string> {
	const registry = PromptRegistry.getInstance()
	return await registry.getVersion(modelId, version, context)
}

// Convenience function for getting a prompt by tag/label
export async function getPromptByTag(
	modelId: string,
	tag?: string,
	label?: string,
	context?: SystemPromptContext,
): Promise<string> {
	const registry = PromptRegistry.getInstance()
	return await registry.getByTag(modelId, tag, label, context)
}
