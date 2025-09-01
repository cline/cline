import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## access_mcp_resource
Description: Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.
Parameters:
- server_name: (required) The name of the MCP server providing the resource
- uri: (required) The URI identifying the specific resource to access
- task_progress: (optional) A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)
Usage:
<access_mcp_resource>
<server_name>server name here</server_name>
<uri>resource URI here</uri>
<task_progress>
Checklist here (optional)
</task_progress>
</access_mcp_resource>
 */

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.MCP_ACCESS,
	name: "access_mcp_resource",
	description:
		"Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.",
	contextRequirements: (context) => context.mcpHub !== undefined && context.mcpHub !== null,
	parameters: [
		{
			name: "server_name",
			required: true,
			instruction: "The name of the MCP server providing the resource",
			usage: "server name here",
		},
		{
			name: "uri",
			required: true,
			instruction: "The URI identifying the specific resource to access",
			usage: "resource URI here",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }
const gpt = { ...generic, variant: ModelFamily.GPT }

export const access_mcp_resource_variants = [generic, nextGen, gpt]
