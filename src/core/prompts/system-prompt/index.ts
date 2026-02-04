import { Logger } from "@/shared/services/Logger"
import { type CustomPromptMetadata, systemPromptsManager } from "../SystemPromptsManager"
import { getSystemPromptComponents } from "./components"
import { PromptRegistry } from "./registry/PromptRegistry"
import { STANDARD_PLACEHOLDERS, SystemPromptSection } from "./templates/placeholders"
import { TemplateEngine } from "./templates/TemplateEngine"
import type { SystemPromptContext } from "./types"

export { ClineToolSet } from "./registry/ClineToolSet"
export { PromptBuilder } from "./registry/PromptBuilder"
export { PromptRegistry } from "./registry/PromptRegistry"
export * from "./templates/placeholders"
export { TemplateEngine } from "./templates/TemplateEngine"
export * from "./types"
export { VariantBuilder } from "./variants/variant-builder"
export { validateVariant } from "./variants/variant-validator"

/**
 * Determines which components to include based on metadata configuration.
 * Uses smart defaults when no explicit component list is provided.
 */
function resolveComponentsToInclude(
	metadata: CustomPromptMetadata,
	variant: { componentOrder: readonly string[] },
	context: SystemPromptContext,
): string[] {
	// If explicit includeComponents is provided, use it
	if (metadata.includeComponents?.length) {
		return metadata.includeComponents
	}

	// Build smart defaults based on feature flags
	const components: string[] = []

	// Tool instructions (default: true)
	if (metadata.includeToolInstructions !== false) {
		components.push(SystemPromptSection.TOOL_USE)
		components.push(SystemPromptSection.TOOLS)
	}

	// Editing guidelines (default: true)
	if (metadata.includeEditingGuidelines !== false) {
		components.push(SystemPromptSection.EDITING_FILES)
	}

	// Browser/capabilities (default: true when browser enabled)
	if (metadata.includeBrowserRules !== false && context.supportsBrowserUse) {
		components.push(SystemPromptSection.CAPABILITIES)
	}

	// MCP section (default: true when MCP configured)
	if (metadata.includeMcpSection !== false && context.mcpHub) {
		components.push(SystemPromptSection.MCP)
	}

	// User instructions (default: true)
	if (metadata.includeUserInstructions !== false) {
		components.push(SystemPromptSection.USER_INSTRUCTIONS)
	}

	// Rules section (default: true)
	if (metadata.includeRules !== false) {
		components.push(SystemPromptSection.RULES)
	}

	// System info section (default: true)
	if (metadata.includeSystemInfo !== false) {
		components.push(SystemPromptSection.SYSTEM_INFO)
	}

	// Skills section (include by default if available)
	if (variant.componentOrder.includes(SystemPromptSection.SKILLS)) {
		components.push(SystemPromptSection.SKILLS)
	}

	return components
}

/**
 * Builds custom prompt by merging user content with default Cline components.
 * This is the core of the custom prompts system - user content is combined
 * with selected default components to maintain Cline's capabilities.
 */
async function buildCustomPrompt(
	customContent: string,
	metadata: CustomPromptMetadata,
	context: SystemPromptContext,
): Promise<string> {
	const registry = PromptRegistry.getInstance()
	await registry.load()

	// Get all available components
	const allComponents = getSystemPromptComponents()
	const componentMap = new Map(allComponents.map((c) => [c.id, c.fn]))

	// Get the variant for context
	const family = registry.getModelFamily(context)
	const variant = registry.getVariantMetadata(family)

	if (!variant) {
		Logger.warn("No variant found for custom prompt, falling back to custom content only")
		return customContent
	}

	// Start with user's custom content
	const sections: string[] = [customContent]

	// Resolve which components to include
	let componentsToInclude = resolveComponentsToInclude(metadata, variant, context)

	// Apply excludeComponents filter
	if (metadata.excludeComponents?.length) {
		const excludeSet = new Set(metadata.excludeComponents)
		componentsToInclude = componentsToInclude.filter((c) => !excludeSet.has(c))
	}

	// Build each component
	for (const componentId of componentsToInclude) {
		const componentFn = componentMap.get(componentId as SystemPromptSection)
		if (componentFn) {
			try {
				const result = await componentFn(variant, context)
				if (result?.trim()) {
					sections.push(`\n====\n\n${result}`)
				}
			} catch (error) {
				Logger.warn(`Failed to build component '${componentId}':`, error)
			}
		}
	}

	return sections.join("\n")
}

/**
 * Resolves placeholders in custom prompt content
 */
function resolveCustomPromptPlaceholders(content: string, context: SystemPromptContext): string {
	const templateEngine = new TemplateEngine()

	// Build placeholder values from context
	const placeholders: Record<string, unknown> = {
		[STANDARD_PLACEHOLDERS.CWD]: context.cwd || process.cwd(),
		[STANDARD_PLACEHOLDERS.SUPPORTS_BROWSER]: context.supportsBrowserUse || false,
		[STANDARD_PLACEHOLDERS.CURRENT_DATE]: new Date().toISOString().split("T")[0],
		IDE: context.ide,
		HAS_MCP: !!context.mcpHub,
		YOLO_MODE: context.yoloModeToggled || false,
	}

	// Add runtime placeholders if present
	if (context.runtimePlaceholders) {
		Object.assign(placeholders, context.runtimePlaceholders)
	}

	return templateEngine.resolve(content, context, placeholders)
}

/**
 * Exports the default system prompt for debugging/reference purposes
 * Useful for users who want to see what the default prompt looks like
 */
export async function exportDefaultPrompt(context: SystemPromptContext): Promise<string> {
	const registry = PromptRegistry.getInstance()
	return await registry.get(context)
}

/**
 * Gets component content by ID for debugging purposes
 */
export async function getComponentContent(
	componentId: SystemPromptSection,
	context: SystemPromptContext,
): Promise<string | undefined> {
	const registry = PromptRegistry.getInstance()
	await registry.load()

	const family = registry.getModelFamily(context)
	const variant = registry.getVariantMetadata(family)
	if (!variant) return undefined

	const allComponents = getSystemPromptComponents()
	const componentFn = allComponents.find((c) => c.id === componentId)?.fn
	if (!componentFn) return undefined

	try {
		return await componentFn(variant, context)
	} catch (error) {
		Logger.warn(`Failed to get component '${componentId}':`, error)
		return undefined
	}
}

/**
 * Gets the system prompt for the current context.
 *
 * If a custom prompt is active, it is merged with Cline's default components.
 * This way users can customize the AI's role and behavior while keeping
 * essential capabilities like tool usage, file editing, and system rules.
 *
 * If no custom prompt is active, returns Cline's default system prompt.
 */
export async function getSystemPrompt(context: SystemPromptContext) {
	// ============================================
	// CUSTOM PROMPT SYSTEM
	// ============================================
	const customPromptData = await systemPromptsManager.getActivePromptWithMetadata()

	if (customPromptData) {
		const { rawContent, metadata } = customPromptData
		Logger.log(`Using custom system prompt with content length: ${rawContent.length}`)
		Logger.log(`Custom prompt metadata: ${JSON.stringify({ name: metadata.name, description: metadata.description })}`)

		// Build custom prompt by merging with default components
		let finalPrompt = await buildCustomPrompt(rawContent, metadata, context)

		// Process placeholders (default: true)
		const shouldProcessPlaceholders = metadata.enablePlaceholders !== false
		if (shouldProcessPlaceholders) {
			finalPrompt = resolveCustomPromptPlaceholders(finalPrompt, context)
		}

		return { systemPrompt: finalPrompt, tools: undefined }
	}

	// ============================================
	// DEFAULT SYSTEM PROMPT
	// ============================================
	const registry = PromptRegistry.getInstance()
	const systemPrompt = await registry.get(context)
	const tools = context.enableNativeToolCalls ? registry.nativeTools : undefined
	return { systemPrompt, tools }
}
