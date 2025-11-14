import { SystemPromptSection } from "../../templates/placeholders"

export const baseTemplate = `{{${SystemPromptSection.AGENT_ROLE}}}

{{${SystemPromptSection.TOOL_USE}}}

## {{${SystemPromptSection.TASK_PROGRESS}}}

## {{${SystemPromptSection.RULES}}}

## {{${SystemPromptSection.ACT_VS_PLAN}}}

## {{${SystemPromptSection.CLI_SUBAGENTS}}}

## {{${SystemPromptSection.CAPABILITIES}}}

## {{${SystemPromptSection.EDITING_FILES}}}

## {{${SystemPromptSection.TODO}}}

## {{${SystemPromptSection.MCP}}}

## {{${SystemPromptSection.SYSTEM_INFO}}}

## {{${SystemPromptSection.OBJECTIVE}}}

## {{${SystemPromptSection.USER_INSTRUCTIONS}}}`
