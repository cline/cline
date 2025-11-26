import type { ApiProviderInfo } from "@/core/api"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import { getDeepPlanningRegistry } from "./registry"
import { generateGemini3Template } from "./variants/gemini3"
import { generateGPT51Template } from "./variants/gpt51"

const focusChainIntro: string = `**Task Progress Parameter:**
When creating the new task, you must include a task_progress parameter that breaks down the implementation into trackable steps. This parameter should be included inside the tool call, but not located inside of other content/argument blocks. This should follow the standard Markdown checklist format with "- [ ]" for incomplete items.`

/**
 * Generates the deep-planning slash command response with model-family-aware variant selection
 * @param focusChainSettings Optional focus chain settings to include in the prompt
 * @param providerInfo Optional API provider info for model family detection
 * @param enableNativeToolCalls Optional flag to determine if native tool calling is enabled
 * @returns The deep-planning prompt string with appropriate variant and focus chain settings applied
 */
export function getDeepPlanningPrompt(
	focusChainSettings?: { enabled: boolean },
	providerInfo?: ApiProviderInfo,
	enableNativeToolCalls?: boolean,
): string {
	// Create context for variant selection
	const context: SystemPromptContext = {
		providerInfo: providerInfo || ({} as ApiProviderInfo),
		ide: "vscode",
	}

	// Get the appropriate variant from registry
	const registry = getDeepPlanningRegistry()
	const variant = registry.get(context)
	const newTaskInstructions = generateNewTaskInstructions(enableNativeToolCalls ?? false)
	const focusChainParam = focusChainSettings?.enabled ? focusChainIntro : ""

	// For variants with extensive focus chain prompting, generate template with focus chain flag
	let template: string
	if (variant.id === "gpt-51") {
		template = generateGPT51Template(focusChainSettings?.enabled ?? false, enableNativeToolCalls ?? false)
	} else if (variant.id === "gemini-3") {
		template = generateGemini3Template(focusChainSettings?.enabled ?? false, enableNativeToolCalls ?? false)
	} else {
		template = variant.template
		template = template.replace("{{FOCUS_CHAIN_PARAM}}", focusChainParam)
		template = template.replace("{{NEW_TASK_INSTRUCTIONS}}", newTaskInstructions)
	}

	return template
}

/**
 * Generates the new_task tool instructions based on whether native tool calling is enabled
 * @param enableNativeToolCalls Whether native tool calling is enabled
 * @returns The new_task tool instructions string
 */
function generateNewTaskInstructions(enableNativeToolCalls: boolean): string {
	if (enableNativeToolCalls) {
		return `
**new_task Tool Definition:**

When you are ready to create the implementation task, you must call the new_task tool with the following structure:

\`\`\`json
{
  "name": "new_task",
  "arguments": {
    "context": "Your detailed context here following the 5-point structure..."
  }
}
\`\`\`

The context parameter should include all five sections as described above.`
	} else {
		return `
**new_task Tool Definition:**

When you are ready to create the implementation task, you must call the new_task tool with the following structure:

\`\`\`xml
<new_task>
<context>Your detailed context here following the 5-point structure...</context>
</new_task>
\`\`\`

The context parameter should include all five sections as described above.`
	}
}

// Export types for external use
export type { DeepPlanningRegistry, DeepPlanningVariant } from "./types"
