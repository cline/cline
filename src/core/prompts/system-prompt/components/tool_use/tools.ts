import { MULTI_ROOT_HINT } from "../../constants"
import { PromptBuilder } from "../../registry/PromptBuilder"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"

export async function getToolUseToolsSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	// Build the tools section
	const toolSections: string[] = ["# Tools"]

	// Get the enabled tool templates for this model family
	const toolsTemplates = await PromptBuilder.getToolsPrompts(variant, context)

	toolSections.push(...toolsTemplates)
	const template = toolSections.join("\n\n")

	// Define multi-root hint based on feature flag
	const multiRootHint = context.isMultiRootEnabled ? MULTI_ROOT_HINT : ""
	return new TemplateEngine().resolve(template, context, {
		TASK_PROGRESS,
		TASK_PROGRESS_ATTEMPT,
		TASK_PROGRESS_USAGE,
		BROWSER_VIEWPORT_WIDTH: context.browserSettings?.viewport?.width || 0,
		BROWSER_VIEWPORT_HEIGHT: context.browserSettings?.viewport?.height || 0,
		CWD: context.cwd,
		MULTI_ROOT_HINT: multiRootHint,
	})
}

// task_progress related constants
const TASK_PROGRESS = `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)`
const TASK_PROGRESS_ATTEMPT = `If you were using task_progress to update the task progress, you must include the completed list in the result as well.`
const TASK_PROGRESS_USAGE = `<task_progress>
Checklist here (optional)
</task_progress>
`
