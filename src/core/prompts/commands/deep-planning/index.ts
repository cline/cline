import type { ApiProviderInfo } from "@/core/api"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import { getDeepPlanningRegistry } from "./registry"

/**
 * Generates the deep-planning slash command response with model-family-aware variant selection
 * @param focusChainSettings Optional focus chain settings to include in the prompt
 * @param providerInfo Optional API provider info for model family detection
 * @returns The deep-planning prompt string with appropriate variant and focus chain settings applied
 */
export function getDeepPlanningPrompt(focusChainSettings?: { enabled: boolean }, providerInfo?: ApiProviderInfo): string {
	// Create context for variant selection
	const context: SystemPromptContext = {
		providerInfo: providerInfo || ({} as ApiProviderInfo),
		ide: "vscode",
	}

	// Get the appropriate variant from registry
	const registry = getDeepPlanningRegistry()
	const variant = registry.get(context)

	// Apply focus chain settings to template
	let template = variant.template

	// Replace the FOCUS_CHAIN_PARAM placeholder with actual content or empty string
	const focusChainParam = focusChainSettings?.enabled
		? `**Task Progress Parameter:**
When creating the new task, you must include a task_progress parameter that breaks down the implementation into trackable steps. This parameter should be included inside the tool call, but not located inside of other content/argument blocks. This should follow the standard Markdown checklist format with "- [ ]" for incomplete items.`
		: ""

	template = template.replace("{{FOCUS_CHAIN_PARAM}}", focusChainParam)

	return template
}

// Export types for external use
export type { DeepPlanningRegistry, DeepPlanningVariant } from "./types"
