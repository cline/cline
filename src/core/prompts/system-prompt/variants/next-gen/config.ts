import type { PromptVariant } from "../../types"
import { ModelFamily } from "../../types"
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
		"tool_use",
		"mcp",
		"editing_files",
		"act_vs_plan_mode",
		"todo",
		"capabilities",
		"feedback",
		"rules",
		"system_info",
		"objective",
		"user_instructions",
	],
	componentOverrides: {
		rules: {
			template: rules_template,
		},
	},
	placeholders: {
		MODEL_FAMILY: "next-gen",
	},
	baseTemplate,
	// Tool configuration - specify which tools to include and their order
	tools: [
		"execute_command",
		"read_file",
		"write_to_file",
		"replace_in_file",
		"search_files",
		"list_files",
		"list_code_definition_names",
		"browser_action",
		"web_fetch", // Available for next-gen models
		"use_mcp_tool",
		"access_mcp_resource",
		"ask_followup_question",
		"attempt_completion",
		"new_task",
		"plan_mode_respond",
		"load_mcp_documentation",
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
