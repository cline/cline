import { SystemPromptSection } from "../../templates/placeholders"

export const baseTemplate = `{{${SystemPromptSection.AGENT_ROLE}}}

## {{${SystemPromptSection.RULES}}}

## {{${SystemPromptSection.ACT_VS_PLAN}}}

## {{${SystemPromptSection.CLI_SUBAGENTS}}}

## {{${SystemPromptSection.CAPABILITIES}}}

## {{${SystemPromptSection.SKILLS}}}

## {{${SystemPromptSection.EDITING_FILES}}}

## {{${SystemPromptSection.TOOLS}}}

## {{${SystemPromptSection.OBJECTIVE}}}

## {{${SystemPromptSection.SYSTEM_INFO}}}

## {{${SystemPromptSection.USER_INSTRUCTIONS}}}`
