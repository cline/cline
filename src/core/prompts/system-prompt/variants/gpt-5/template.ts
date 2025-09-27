import { SystemPromptSection } from "../../templates/placeholders"
import type { SystemPromptContext } from "../../types"

/**
 * Base template for GPT-5 variant with structured sections
 * Removed SystemPromptSection.TASK_PROGRESS
 */
export const BASE = `{{${SystemPromptSection.AGENT_ROLE}}}

{{${SystemPromptSection.TOOL_USE}}}

====

{{${SystemPromptSection.TODO}}}

====

{{${SystemPromptSection.MCP}}}

====

{{${SystemPromptSection.EDITING_FILES}}}

====

{{${SystemPromptSection.ACT_VS_PLAN}}}

====

{{${SystemPromptSection.CAPABILITIES}}}

====

{{${SystemPromptSection.FEEDBACK}}}

====

{{${SystemPromptSection.RULES}}}

====

{{${SystemPromptSection.SYSTEM_INFO}}}

====

{{${SystemPromptSection.OBJECTIVE}}}

====

{{${SystemPromptSection.USER_INSTRUCTIONS}}}`

const RULES = (_context: SystemPromptContext) => `RULES

- Your current working directory is: {{CWD}} - this is where you will be using tools from.
- Do not use the ~ character or $HOME to refer to the home directory. Use absolute paths instead.
- MCP operations should be used one at a time, similar to other tool usage. Wait for confirmation of success before proceeding with additional operations.`

const TOOL_USE = `TOOL USE

You have access to a set of tools that are executed upon the user's approval. You can use one tool per message, and will receive the result of that tool use in the user's response. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.`
export const GPT_5_TEMPLATE_OVERRIDES = {
	BASE,
	RULES,
	TOOL_USE,
} as const
