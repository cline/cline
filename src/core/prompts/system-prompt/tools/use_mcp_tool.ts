import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
## use_mcp_tool
Description: Request to use a tool provided by a connected MCP server. Each MCP server can provide multiple tools with different capabilities. Tools have defined input schemas that specify required and optional parameters.
Parameters:
- server_name: (required) The name of the MCP server providing the tool
- tool_name: (required) The name of the tool to execute
- arguments: (required) A JSON object containing the tool's input parameters, following the tool's input schema
${focusChainSettings.enabled ? `- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)` : ""}
Usage:
<use_mcp_tool>
<server_name>server name here</server_name>
<tool_name>tool name here</tool_name>
<arguments>
{
  "param1": "value1",
  "param2": "value2"
}
</arguments>
${
	focusChainSettings.enabled
		? `<task_progress>
Checklist here (optional)
</task_progress>`
		: ""
}
</use_mcp_tool>
 */

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.MCP_USE,
	name: "use_mcp_tool",
	description:
		"Request to use a tool provided by a connected MCP server. Each MCP server can provide multiple tools with different capabilities. Tools have defined input schemas that specify required and optional parameters.",
	contextRequirements: (context) => context.mcpHub !== undefined && context.mcpHub !== null,
	parameters: [
		{
			name: "server_name",
			required: true,
			instruction: "The name of the MCP server providing the tool",
			usage: "server name here",
		},
		{
			name: "tool_name",
			required: true,
			instruction: "The name of the tool to execute",
			usage: "tool name here",
		},
		{
			name: "arguments",
			required: true,
			instruction: "A JSON object containing the tool's input parameters, following the tool's input schema",
			usage: `
{
  "param1": "value1",
  "param2": "value2"
}
`,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const use_mcp_tool_variants = [generic]
