import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const FEEDBACK_TEMPLATE_TEXT = `
If the user asks for help or wants to give feedback inform them of the following:
- To give feedback, users should report the issue at https://github.com/AI-Hydro/AI-Hydro/issues

When the user directly asks about AI-Hydro (eg 'can AI-Hydro do...', 'does AI-Hydro have...') or asks in second person (eg 'are you able...', 'can you do...'), first use the web_fetch tool to gather information to answer the question from AI-Hydro docs at https://ai-hydro.github.io/AI-Hydro/.
  - The available sub-pages are \`getting-started/installation\` (Installing the VS Code extension and Python backend), \`getting-started/quickstart\` (First steps), \`guide/sessions\` (Sessions and provenance), \`guide/vscode-extension\` (VS Code extension guide), \`tools/\` (Tool reference — analysis, modelling, session, project tools), \`plugins/overview\` (Plugin system — contributing tools and knowledge cards), \`architecture\` (Platform architecture), \`changelog\` (Version history), \`faq\` (Frequently asked questions)
  - Example: https://ai-hydro.github.io/AI-Hydro/tools/analysis`

export async function getFeedbackSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	const template = variant.componentOverrides?.[SystemPromptSection.FEEDBACK]?.template || FEEDBACK_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, context, {})
}
