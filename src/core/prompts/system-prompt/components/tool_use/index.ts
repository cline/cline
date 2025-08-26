import { SystemPromptSection } from "../../templates/placeholders"
import { TemplateEngine } from "../../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../../types"
import { getToolUseExamplesSection } from "./examples"
import { getToolUseFormattingSection } from "./formatting"
import { getToolUseGuidelinesSection } from "./guidelines"
import { getToolUseToolsSection } from "./tools"

export async function getToolUseSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template = variant.componentOverrides?.[SystemPromptSection.TOOL_USE]?.template || TOOL_USE_TEMPLATE_TEXT

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, {
		TOOL_USE_FORMATTING_SECTION: await getToolUseFormattingSection(variant, context),
		TOOLS_SECTION: await getToolUseToolsSection(variant, context),
		TOOL_USE_EXAMPLES_SECTION: await getToolUseExamplesSection(variant, context),
		TOOL_USE_GUIDELINES_SECTION: await getToolUseGuidelinesSection(variant, context),
		CWD: context.cwd,
	})
}

const TOOL_USE_TEMPLATE_TEXT = `TOOL USE

You have access to a set of tools that are executed upon the user's approval. You can use one tool per message, and will receive the result of that tool use in the user's response. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

{{TOOL_USE_FORMATTING_SECTION}}

{{TOOLS_SECTION}}

{{TOOL_USE_EXAMPLES_SECTION}}

{{TOOL_USE_GUIDELINES_SECTION}}`
