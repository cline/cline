import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import type { PromptVariant } from "../../types"
import { baseTemplate, rules_template } from "./template"

export const config: Omit<PromptVariant, "id"> = {
	version: 1,
	family: ModelFamily.NEXT_GEN,
	tags: ["next-gen", "advanced", "production"],
	labels: {
		stable: 1,
		production: 1,
		advanced: 1,
	},
	config: {},
	componentOrder: [
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.MCP,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.TODO,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
	],
	componentOverrides: {
		[SystemPromptSection.RULES]: {
			template: rules_template,
		},
	},
	placeholders: {
		MODEL_FAMILY: ModelFamily.NEXT_GEN,
	},
	baseTemplate,
	// Tool configuration - specify which tools to include and their order
	tools: [
		ClineDefaultTool.BASH,
		ClineDefaultTool.FILE_READ,
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.SEARCH,
		ClineDefaultTool.LIST_FILES,
		ClineDefaultTool.LIST_CODE_DEF,
		ClineDefaultTool.BROWSER,
		ClineDefaultTool.WEB_FETCH,
		ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.NEW_TASK,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
	],

	// Tool overrides - customize specific tools
	toolOverrides: {
		// Example: Customize the execute_command tool
		// execute_command: {
		// 	template: "## execute_command\nCustom template for execute_command...",
		// 	enabled: true,
		// },
		// Example: Disable a specific tool
		// browser_action: {
		// 	enabled: false,
		// },
	},
}
