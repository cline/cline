import { ToolDefinition } from "@core/prompts/model_prompts/jsonToolToXml"

export const useMCPToolName = "UseMCPTool"

const descriptionForAgent = `Request to use a tool provided by a connected MCP server. Each MCP server can provide multiple tools with different capabilities. Tools have defined input schemas that specify required and optional parameters.`

export const useMCPToolDefinition: ToolDefinition = {
	name: useMCPToolName,
	descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			server_name: {
				type: "string",
				description: "The name of the MCP server providing the tool",
			},
			tool_name: {
				type: "string",
				description: "The name of the tool to execute",
			},
			arguments: {
				type: "object",
				description: "A JSON object containing the tool's input parameters, following the tool's input schema",
			},
		},
		required: ["server_name", "tool_name", "arguments"],
	},
}
