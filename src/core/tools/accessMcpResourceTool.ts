const descriptionForAgent = `Request to access a resource provided by a connected MCP server. Resources represent data sources that can be used as context, such as files, API responses, or system information.`

export const accessMcpResourceToolDefinition = {
	name: "AccessMCPResource",
	descriptionForAgent,
	inputSchema: {
		type: "object",
		properties: {
			server_name: {
				type: "string",
				description: "The name of the MCP server providing the resource",
			},
			uri: {
				type: "string",
				description: "The URI identifying the specific resource to access",
			},
		},
		required: ["server_name", "uri"],
	},
}
