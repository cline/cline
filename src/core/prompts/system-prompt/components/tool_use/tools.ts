import { PromptBuilder } from "../../registry/PromptBuilder"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseToolsSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const focusChainEnabled = context.focusChainSettings?.enabled

	// Build the tools section
	const toolSections: string[] = ["# Tools"]

	// Get the enabled tool templates for this model family
	const toolsTemplates = await PromptBuilder.getToolsPrompts(variant, context)

	toolSections.push(...toolsTemplates)
	const template = toolSections.join("\n\n")

	// Include task_progress related placeholders when focus chain is enabled
	// (TODO tool is now dynamically added when focusChainEnabled is true)
	const shouldIncludeTaskProgress = focusChainEnabled

	// Define multi-root hint based on feature flag
	const multiRootHint = context.isMultiRootEnabled ? MULTI_ROOT_HINT : ""
	return new TemplateEngine().resolve(template, context, {
		TASK_PROGRESS: shouldIncludeTaskProgress ? TASK_PROGRESS : "",
		FOCUS_CHAIN_ATTEMPT: shouldIncludeTaskProgress ? FOCUS_CHAIN_ATTEMPT : "",
		FOCUS_CHAIN_USAGE: shouldIncludeTaskProgress ? FOCUS_CHAIN_USAGE : "",
		BROWSER_VIEWPORT_WIDTH: context.browserSettings?.viewport?.width || 0,
		BROWSER_VIEWPORT_HEIGHT: context.browserSettings?.viewport?.height || 0,
		CWD: context.cwd,
		MULTI_ROOT_HINT: multiRootHint,
	})
}

// Focus chain related constants
const TASK_PROGRESS = `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)`
const FOCUS_CHAIN_ATTEMPT = `If you were using task_progress to update the task progress, you must include the completed list in the result as well.`
const FOCUS_CHAIN_USAGE = `<task_progress>
Checklist here (optional)
</task_progress>
`
const MULTI_ROOT_HINT = " Use @workspace:path syntax (e.g., @frontend:src/index.ts) to specify a workspace."
