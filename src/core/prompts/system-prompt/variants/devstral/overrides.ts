import { SystemPromptSection } from "../../templates/placeholders"

export const DEVSTRAL_AGENT_ROLE_TEMPLATE = `You are Cline, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.
`

export const devstralComponentOverrides = {
	[SystemPromptSection.AGENT_ROLE]: {
		template: DEVSTRAL_AGENT_ROLE_TEMPLATE,
	},
}
