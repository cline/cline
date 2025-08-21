import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import type { PromptVariant } from "../../types"
import { xsComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"

export const config: Omit<PromptVariant, "id"> = {
	version: 1,
	family: ModelFamily.XS,
	tags: ["local", "xs", "compact"],
	description: "Prompt for models with a small context window.",
	labels: {
		stable: 1,
		production: 1,
		advanced: 1,
	},
	config: {},
	componentOrder: [
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.RULES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.USER_INSTRUCTIONS,
	],
	componentOverrides: xsComponentOverrides,
	placeholders: {
		MODEL_FAMILY: ModelFamily.XS,
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
		ClineDefaultTool.ASK,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.NEW_TASK,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.MCP_DOCS,
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
