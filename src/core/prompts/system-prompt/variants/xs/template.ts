import { SystemPromptSection } from "../../templates/placeholders"

export const baseTemplate = `{{${SystemPromptSection.AGENT_ROLE}}}

## {{${SystemPromptSection.ACT_VS_PLAN}}}

## {{${SystemPromptSection.OBJECTIVE}}}

## {{${SystemPromptSection.TOOL_USE}}}

## {{${SystemPromptSection.TOOLS}}}

## {{${SystemPromptSection.RULES}}}

## {{${SystemPromptSection.EDITING_FILES}}}

## {{${SystemPromptSection.SYSTEM_INFO}}}

== BEHAVIOR ==
Analyze environment_details before using a tool. If required params are present or inferable, invoke the tool; else use ask_followup_question. Aim to accomplish the task, not chat.

## {{${SystemPromptSection.USER_INSTRUCTIONS}}}`
