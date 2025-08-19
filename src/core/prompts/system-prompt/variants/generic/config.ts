import type { PromptVariant } from "../../types"
import { ModelFamily } from "../../types"
import { baseTemplate } from "./template"

export const config: Omit<PromptVariant, "id"> = {
	version: 1,
	family: ModelFamily.GENERIC,
	tags: ["fallback", "stable"],
	labels: {
		stable: 1,
		fallback: 1,
	},
	config: {},
	componentOrder: [
		"tool_use",
		"mcp",
		"editing_files",
		"act_vs_plan_mode",
		"todo",
		"capabilities",
		"rules",
		"system_info",
		"objective",
		"user_instructions",
	],
	componentOverrides: {},
	placeholders: {
		MODEL_FAMILY: "generic",
	},
	baseTemplate,
	tools: [
		"execute_command",
		"read_file",
		"write_to_file",
		"replace_in_file",
		"search_files",
		"list_files",
		"list_code_definition_names",
		"browser_action",
		"use_mcp_tool",
		"access_mcp_resource",
		"ask_followup_question",
		"attempt_completion",
		"new_task",
		"plan_mode_respond",
		"load_mcp_documentation",
	],
}
