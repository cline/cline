// Import all tool variants
import { ClineToolSet } from "../registry/ClineToolSet"
import { access_mcp_resource_variants } from "./access_mcp_resource"
import { ask_followup_question_variants } from "./ask_followup_question"
import { attempt_completion_variants } from "./attempt_completion"
import { browser_action_variants } from "./browser_action"
import { execute_command_variants } from "./execute_command"
import { focus_chain_variants } from "./focus_chain"
import { list_code_definition_names_variants } from "./list_code_definition_names"
import { list_files_variants } from "./list_files"
import { load_mcp_documentation_variants } from "./load_mcp_documentation"
import { new_task_variants } from "./new_task"
import { plan_mode_respond_variants } from "./plan_mode_respond"
import { read_file_variants } from "./read_file"
import { replace_in_file_variants } from "./replace_in_file"
import { search_files_variants } from "./search_files"
import { use_mcp_tool_variants } from "./use_mcp_tool"
import { web_fetch_variants } from "./web_fetch"
import { write_to_file_variants } from "./write_to_file"

/**
 * Registers all tool variants with the ClineToolSet provider.
 * This function must be called at prompt registry
 * to allow all tool sets be available at build time.
 */
export function registerClineToolSets(): void {
	// Collect all variants from all tools
	const allToolVariants = [
		...access_mcp_resource_variants,
		...ask_followup_question_variants,
		...attempt_completion_variants,
		...browser_action_variants,
		...execute_command_variants,
		...focus_chain_variants,
		...list_code_definition_names_variants,
		...list_files_variants,
		...load_mcp_documentation_variants,
		...new_task_variants,
		...plan_mode_respond_variants,
		...read_file_variants,
		...replace_in_file_variants,
		...search_files_variants,
		...use_mcp_tool_variants,
		...web_fetch_variants,
		...write_to_file_variants,
	]

	// Register each variant
	allToolVariants.forEach((v) => {
		ClineToolSet.register(v)
	})
}
