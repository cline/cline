import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * ## load_mcp_documentation
Description: Load documentation about creating MCP servers. This tool should be used when the user requests to create or install an MCP server (the user may ask you something along the lines of "add a tool" that does some function, in other words to create an MCP server that provides tools and resources that may connect to external APIs for example. You have the ability to create an MCP server and add it to a configuration file that will then expose the tools and resources for you to use with \`use_mcp_tool\` and \`access_mcp_resource\`). The documentation provides detailed information about the MCP server creation process, including setup instructions, best practices, and examples.
Parameters: None
Usage:
<load_mcp_documentation>
</load_mcp_documentation>
 */

const id = ClineDefaultTool.MCP_DOCS

const generic: ClineToolSpec = {
	id,
	variant: ModelFamily.GENERIC,
	name: "load_mcp_documentation",
	description: `Load documentation about creating MCP servers. This tool should be used when the user requests to create or install an MCP server (the user may ask you something along the lines of "add a tool" that does some function, in other words to create an MCP server that provides tools and resources that may connect to external APIs for example. You have the ability to create an MCP server and add it to a configuration file that will then expose the tools and resources for you to use with \`use_mcp_tool\` and \`access_mcp_resource\`). The documentation provides detailed information about the MCP server creation process, including setup instructions, best practices, and examples.`,
	contextRequirements: (context) => context.mcpHub !== undefined && context.mcpHub !== null,
}

export const load_mcp_documentation_variants = [generic]
