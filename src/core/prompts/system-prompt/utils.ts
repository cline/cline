import { ApiHandlerModel } from "@core/api"
import { McpServer } from "@/shared/mcp"

export function isClaude4ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return (
		modelId.includes("sonnet-4") || modelId.includes("opus-4") || modelId.includes("4-sonnet") || modelId.includes("4-opus")
	)
}

export function isGemini2dot5ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("gemini-2.5")
}

export function isGrok4ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("grok-4")
}

export function isGPT5ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("gpt-5") || modelId.includes("gpt5")
}

export function isNextGenModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	return (
		isClaude4ModelFamily(apiHandlerModel) ||
		isGemini2dot5ModelFamily(apiHandlerModel) ||
		isGrok4ModelFamily(apiHandlerModel) ||
		isGPT5ModelFamily(apiHandlerModel)
	)
}

export function isLocalModelFamily(providerId: string): boolean {
	const localModels = ["lmstudio", "ollama"]
	return localModels.includes(providerId)
}

export function getMCPServersPrompt(servers: McpServer[] = []) {
	if (!servers.length) {
		return undefined
	}
	return servers
		?.filter((server) => server.status === "connected")
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
				(config.command
					? ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)`
					: "") +
				(tools ? `\n\n### Available Tools\n${tools}` : "") +
				(templates ? `\n\n### Resource Templates\n${templates}` : "") +
				(resources ? `\n\n### Direct Resources\n${resources}` : "")
			)
		})
		.join("\n\n")
}
