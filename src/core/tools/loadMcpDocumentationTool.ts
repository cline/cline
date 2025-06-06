import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const loadMcpDocumentationToolName = "LoadMcpDocumentation"

const descriptionForAgent = (useMCPToolName: string, accessMcpResourceToolName: string) =>
	`Load documentation about creating MCP servers. This tool should be used when the user requests to create or install an MCP server (the user may ask you something along the lines of "add a tool" that does some function, in other words to create an MCP server that provides tools and resources that may connect to external APIs for example. You have the ability to create an MCP server and add it to a configuration file that will then expose the tools and resources for you to use with \`${useMCPToolName}\` and \`${accessMcpResourceToolName}\`). The documentation provides detailed information about the MCP server creation process, including setup instructions, best practices, and examples.`

export const loadMcpDocumentationToolDefinition = (
	useMCPToolName: string,
	accessMcpResourceToolName: string,
): ToolDefinition => ({
	name: loadMcpDocumentationToolName,
	descriptionForAgent: descriptionForAgent(useMCPToolName, accessMcpResourceToolName),
	inputSchema: {
		type: "object",
		properties: {},
		required: [],
	},
})
