import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const AGENT_ROLE = [
	"You are Cline,",
	"a highly skilled software engineer",
	"with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
]

export async function getAgentRoleSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	let template = variant.componentOverrides?.[SystemPromptSection.AGENT_ROLE]?.template || AGENT_ROLE.join(" ")

	if (typeof template === "function") {
		template = template(context)
	}

	return new TemplateEngine().resolve(template, {})
}
