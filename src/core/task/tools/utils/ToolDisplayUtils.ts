import { ToolParamName, ToolUse } from "@core/assistant-message"

/**
 * Utility functions for tool display and formatting
 */
export class ToolDisplayUtils {
	/**
	 * Get the display name for a tool based on its parameters
	 */
	static getToolDisplayName(block: ToolUse): string {
		if (block.name === "list_files") {
			return block.params.recursive?.toLowerCase() === "true" ? "listFilesRecursive" : "listFilesTopLevel"
		}
		return "readFile"
	}

	/**
	 * Generate a descriptive string for a tool execution
	 */
	static getToolDescription(block: ToolUse): string {
		switch (block.name) {
			case "execute_command":
				return `[${block.name} for '${block.params.command}']`
			case "read_file":
				return `[${block.name} for '${block.params.path}']`
			case "write_to_file":
				return `[${block.name} for '${block.params.path}']`
			case "replace_in_file":
				return `[${block.name} for '${block.params.path}']`
			case "search_files":
				return `[${block.name} for '${block.params.regex}'${
					block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
				}]`
			case "list_files":
				return `[${block.name} for '${block.params.path}']`
			case "list_code_definition_names":
				return `[${block.name} for '${block.params.path}']`
			case "browser_action":
				return `[${block.name} for '${block.params.action}']`
			case "use_mcp_tool":
				return `[${block.name} for '${block.params.server_name}']`
			case "access_mcp_resource":
				return `[${block.name} for '${block.params.server_name}']`
			case "ask_followup_question":
				return `[${block.name} for '${block.params.question}']`
			case "plan_mode_respond":
				return `[${block.name}]`
			case "load_mcp_documentation":
				return `[${block.name}]`
			case "attempt_completion":
				return `[${block.name}]`
			case "new_task":
				return `[${block.name} for creating a new task]`
			case "condense":
				return `[${block.name}]`
			case "summarize_task":
				return `[${block.name}]`
			case "report_bug":
				return `[${block.name}]`
			case "new_rule":
				return `[${block.name} for '${block.params.path}']`
			case "web_fetch":
				return `[${block.name} for '${block.params.url}']`
		}
	}

	/**
	 * Remove partial closing tag from tool parameter text
	 * If block is partial, remove partial closing tag so it's not presented to user
	 */
	static removeClosingTag(block: ToolUse, tag: ToolParamName, text?: string): string {
		if (!block.partial) {
			return text || ""
		}
		if (!text) {
			return ""
		}
		// This regex dynamically constructs a pattern to match the closing tag:
		// - Optionally matches whitespace before the tag
		// - Matches '<' or '</' optionally followed by any subset of characters from the tag name
		const tagRegex = new RegExp(
			`\\s?<\/?${tag
				.split("")
				.map((char) => `(?:${char})?`)
				.join("")}$`,
			"g",
		)
		return text.replace(tagRegex, "")
	}
}
