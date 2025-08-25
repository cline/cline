import { ToolUse } from "@core/assistant-message"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import * as path from "path"
import { ToolDisplayUtils } from "./ToolDisplayUtils"

/**
 * Utility functions for creating tool-related UI messages
 */
export class ToolMessageUtils {
	/**
	 * Create shared message properties for file-related tools
	 */
	static async createFileToolMessageProps(
		block: ToolUse,
		cwd: string,
		removeClosingTag: (block: ToolUse, tag: any, text?: string) => string,
		result?: any,
	): Promise<any> {
		const relPath = block.params.path
		const tool = ToolDisplayUtils.getToolDisplayName(block)

		return {
			tool,
			path: getReadablePath(cwd, removeClosingTag(block, "path", relPath)),
			content: block.name === "list_files" ? result || "" : undefined,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}
	}

	/**
	 * Create shared message properties for write-related tools
	 */
	static async createWriteToolMessageProps(
		block: ToolUse,
		cwd: string,
		fileExists: boolean,
		removeClosingTag: (block: ToolUse, tag: any, text?: string) => string,
	): Promise<any> {
		const relPath = block.params.path
		const content = block.params.content || block.params.diff

		return {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(cwd, removeClosingTag(block, "path", relPath)),
			content: removeClosingTag(block, block.name === "replace_in_file" ? "diff" : "content", content),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}
	}

	/**
	 * Create message properties for MCP tools
	 */
	static createMcpToolMessageProps(block: ToolUse, removeClosingTag: (block: ToolUse, tag: any, text?: string) => string): any {
		const server_name = block.params.server_name
		const tool_name = block.params.tool_name
		const uri = block.params.uri
		const mcp_arguments = block.params.arguments

		return {
			type: block.name === "use_mcp_tool" ? "use_mcp_tool" : "access_mcp_resource",
			serverName: removeClosingTag(block, "server_name", server_name),
			toolName: removeClosingTag(block, "tool_name", tool_name),
			uri: removeClosingTag(block, "uri", uri),
			arguments: removeClosingTag(block, "arguments", mcp_arguments),
		}
	}

	/**
	 * Create message properties for browser actions
	 */
	static createBrowserActionMessageProps(
		block: ToolUse,
		removeClosingTag: (block: ToolUse, tag: any, text?: string) => string,
	): any {
		const action = block.params.action
		const coordinate = block.params.coordinate
		const text = block.params.text
		const url = block.params.url

		return {
			action: removeClosingTag(block, "action", action),
			coordinate: coordinate ? removeClosingTag(block, "coordinate", coordinate) : undefined,
			text: text ? removeClosingTag(block, "text", text) : undefined,
			url: url ? removeClosingTag(block, "url", url) : undefined,
		}
	}

	/**
	 * Create notification message for tool approval
	 */
	static createNotificationMessage(block: ToolUse, relPath?: string, fileExists?: boolean): string {
		switch (block.name) {
			case "list_files":
				return `Cline wants to view directory ${path.basename(path.resolve(relPath || ""))}/`
			case "read_file":
			case "list_code_definition_names":
			case "search_files":
				return `Cline wants to read ${path.basename(path.resolve(relPath || ""))}`
			case "write_to_file":
			case "replace_in_file":
			case "new_rule":
				return `Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath || "")}`
			case "use_mcp_tool":
				return `Cline wants to use ${block.params.tool_name} on ${block.params.server_name}`
			case "access_mcp_resource":
				return `Cline wants to access ${block.params.uri} on ${block.params.server_name}`
			case "browser_action":
				const action = block.params.action
				switch (action) {
					case "launch":
						return `Cline wants to launch browser at ${block.params.url}`
					case "click":
						return `Cline wants to click at coordinates ${block.params.coordinate}`
					case "type":
						return `Cline wants to type "${block.params.text}"`
					case "scroll_down":
						return "Cline wants to scroll down"
					case "scroll_up":
						return "Cline wants to scroll up"
					case "close":
						return "Cline wants to close the browser"
					default:
						return `Cline wants to perform browser action: ${action}`
				}
			default:
				return `Cline wants to use ${block.name}`
		}
	}
}
