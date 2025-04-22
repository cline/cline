import { McpServer, McpTool, McpResource, McpResourceTemplate } from "../../mcp"
import {
	McpServer as ProtoMcpServer,
	McpTool as ProtoMcpTool,
	McpResource as ProtoMcpResource,
	McpResourceTemplate as ProtoMcpResourceTemplate,
} from "../../proto/mcp"

export function convertMcpServersToProtoMcpServers(mcpServers: McpServer[]): ProtoMcpServer[] {
	const protoServers: ProtoMcpServer[] = mcpServers.map((server) => ({
		name: server.name,
		config: server.config,
		status: server.status,
		error: server.error || "", // Ensure error is always a string, even if it was undefined

		// Convert nested types, ensuring all required fields have values
		tools: (server.tools || []).map(convertTool),
		resources: (server.resources || []).map(convertResource),
		resourceTemplates: (server.resourceTemplates || []).map(convertResourceTemplate),

		disabled: server.disabled || false,
		timeout: server.timeout || 0,
	}))
	return protoServers
}

/**
 * Converts McpTool to ProtoMcpTool format, ensuring all required fields have values
 */
function convertTool(tool: McpTool): ProtoMcpTool {
	return {
		name: tool.name,
		description: tool.description || "",
		inputSchema: typeof tool.inputSchema === "object" ? JSON.stringify(tool.inputSchema) : tool.inputSchema || "",
		autoApprove: tool.autoApprove || false,
	}
}

/**
 * Converts McpResource to ProtoMcpResource format, ensuring all required fields have values
 */
function convertResource(resource: McpResource): ProtoMcpResource {
	return {
		uri: resource.uri,
		name: resource.name,
		mimeType: resource.mimeType || "",
		description: resource.description || "",
	}
}

/**
 * Converts McpResourceTemplate to ProtoMcpResourceTemplate format, ensuring all required fields have values
 */
function convertResourceTemplate(template: McpResourceTemplate): ProtoMcpResourceTemplate {
	return {
		uriTemplate: template.uriTemplate,
		name: template.name,
		mimeType: template.mimeType || "",
		description: template.description || "",
	}
}

export function convertProtoMcpServersToMcpServers(protoServers: ProtoMcpServer[]): McpServer[] {
	const mcpServers: McpServer[] = protoServers.map((protoServer) => {
		// Validate that status is one of the allowed values
		const status = validateMcpStatus(protoServer.status)

		return {
			name: protoServer.name,
			config: protoServer.config,
			status, // Using validated status
			error: protoServer.error === "" ? undefined : protoServer.error, // Convert empty string back to undefined

			// Convert nested types
			tools: protoServer.tools.map(convertProtoTool),
			resources: protoServer.resources.map(convertProtoResource),
			resourceTemplates: protoServer.resourceTemplates.map(convertProtoResourceTemplate),

			disabled: protoServer.disabled,
			timeout: protoServer.timeout,
		}
	})
	return mcpServers
}

/**
 * Validates and converts a string to a valid McpServer status
 */
function validateMcpStatus(status: string): "connected" | "connecting" | "disconnected" {
	if (status === "connected" || status === "connecting" || status === "disconnected") {
		return status
	}
	// Default to disconnected if an invalid status is provided
	return "disconnected"
}

/**
 * Converts ProtoMcpTool to McpTool format, parsing inputSchema if needed
 */
function convertProtoTool(protoTool: ProtoMcpTool): McpTool {
	return {
		name: protoTool.name,
		description: protoTool.description === "" ? undefined : protoTool.description,
		inputSchema: protoTool.inputSchema
			? protoTool.inputSchema.startsWith("{")
				? JSON.parse(protoTool.inputSchema)
				: protoTool.inputSchema
			: undefined,
		autoApprove: protoTool.autoApprove,
	}
}

/**
 * Converts ProtoMcpResource to McpResource format
 */
function convertProtoResource(protoResource: ProtoMcpResource): McpResource {
	return {
		uri: protoResource.uri,
		name: protoResource.name,
		mimeType: protoResource.mimeType === "" ? undefined : protoResource.mimeType,
		description: protoResource.description === "" ? undefined : protoResource.description,
	}
}

/**
 * Converts ProtoMcpResourceTemplate to McpResourceTemplate format
 */
function convertProtoResourceTemplate(protoTemplate: ProtoMcpResourceTemplate): McpResourceTemplate {
	return {
		uriTemplate: protoTemplate.uriTemplate,
		name: protoTemplate.name,
		mimeType: protoTemplate.mimeType === "" ? undefined : protoTemplate.mimeType,
		description: protoTemplate.description === "" ? undefined : protoTemplate.description,
	}
}
