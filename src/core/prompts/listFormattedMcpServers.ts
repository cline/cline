import { McpHub } from "@/services/mcp/McpHub"

export const listFormattedMcpServers = (mcpHub: McpHub): string => {
	return mcpHub.getServers().length > 0
		? `${mcpHub
				.getServers()
				.filter((server) => server.status === "connected")
				.map((server) => {
					const tools = server.tools
						?.map((tool) => {
							const schemaStr = tool.inputSchema
								? `    Input Schema:
    ${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}`
								: ""

							return `- ${tool.name}: ${tool.description}\n${schemaStr}`
						})
						.join("\n\n")

					const templates = server.resourceTemplates
						?.map((template) => `- ${template.uriTemplate} (${template.name}): ${template.description}`)
						.join("\n")

					const resources = server.resources
						?.map((resource) => `- ${resource.uri} (${resource.name}): ${resource.description}`)
						.join("\n")

					const config = JSON.parse(server.config)

					return (
						`## ${server.name}` +
						(tools ? `\n\n### Available Tools\n${tools}` : "") +
						(templates ? `\n\n### Resource Templates\n${templates}` : "") +
						(resources ? `\n\n### Direct Resources\n${resources}` : "")
					)
				})
				.join("\n\n")}`
		: "(No MCP servers currently connected)"
}
