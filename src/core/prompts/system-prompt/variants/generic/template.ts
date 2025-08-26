import { SystemPromptSection } from "../.."

export const baseTemplate = `{{${SystemPromptSection.AGENT_ROLE}}}

{{TOOL_USE_SECTION}}

====

{{TASK_PROGRESS_SECTION}}

====

{{MCP_SECTION}}

====

{{EDITING_FILES_SECTION}}

====

{{ACT_VS_PLAN_SECTION}}

====

{{TODO_SECTION}}

====

{{CAPABILITIES_SECTION}}

====

{{RULES_SECTION}}

====

{{SYSTEM_INFO_SECTION}}

====

{{OBJECTIVE_SECTION}}

====

{{USER_INSTRUCTIONS_SECTION}}`
