import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../templates/placeholders"
import { PromptVariant } from "../types"

export const config: Omit<PromptVariant, "id"> = {
	version: 0,

	// The model family that this prompt is designed for.
	// Models are assigned to a ModelFamily by the getModelFamily function,
	// with ModelFamily.GENERIC as the default fallback
	family: ModelFamily.GENERIC,

	// Labels that allow for easy identification and categorization - currently not supported
	tags: ["next-gen", "advanced", "production"],

	// Description of the prompt variant - what it is designed for and how it differs from other variants etc
	description: "This is a prompt for next-gen models.",

	// The labels for this prompt variant
	labels: {
		stable: 1,
		production: 1,
		advanced: 1,
	},

	// Model configuration settings - currently not supported
	config: {},

	// The base template
	baseTemplate: "TEMPLATE BASE",

	// The components to include in the order listed below
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
	// The component overrides to customize specific components
	componentOverrides: {
		// [SystemPromptSection.RULES]: {
		// 	template: "**RULES**\nTEMPLATE TEXT HERE",
		// },
		// [SystemPromptSection.FEEDBACK]: {
		// 	enabled: false
		// },
		// [SystemPromptSection.ACT_VS_PLAN]: {
		// 	template: "ACT VS PLAN MODE\n{{ACT_VS_PLAN_DESCRIPTION_TEXT}}",
		// },
	},
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
		// [ClineDefaultTool.BASH]: {
		// 	template: "## execute_command\nCustom template for execute_command...",
		// 	enabled: true,
		// },
		// Example: Disable a specific tool
		// [ClineDefaultTool.BROWSER]: {
		// 	enabled: false,
		// },
	},

	// The placeholders to replace in the templates
	placeholders: {
		MODEL_FAMILY: ModelFamily.NEXT_GEN,
		// ACT_VS_PLAN_DESCRIPTION_TEXT: "This is the text to replace the {{ACT_VS_PLAN_DESCRIPTION_TEXT}} placeholder listed in the componentOverrides."
	},
}
