import { McpServer, McpTool, McpResource, McpResourceTemplate } from "../../mcp"
import {
	McpServer as ProtoMcpServer,
	McpTool as ProtoMcpTool,
	McpResource as ProtoMcpResource,
	McpResourceTemplate as ProtoMcpResourceTemplate,
	McpServerStatus,
} from "@shared/proto/cline/mcp"

// Helper to convert TS status to Proto enum
function convertMcpStatusToProto(status: McpServer["status"]): McpServerStatus {
	switch (status) {
		case "connected":
			return McpServerStatus.MCP_SERVER_STATUS_CONNECTED
		case "connecting":
			return McpServerStatus.MCP_SERVER_STATUS_CONNECTING
		case "disconnected":
			return McpServerStatus.MCP_SERVER_STATUS_DISCONNECTED
	}
}

export function convertMcpServersToProtoMcpServers(mcpServers: McpServer[]): ProtoMcpServer[] {
	const protoServers: ProtoMcpServer[] = mcpServers.map((server) => ({
		name: server.name,
		config: server.config,
		status: convertMcpStatusToProto(server.status),
		error: server.error,

		// Convert nested types
		tools: (server.tools || []).map(convertTool),
		resources: (server.resources || []).map(convertResource),
		resourceTemplates: (server.resourceTemplates || []).map(convertResourceTemplate),

		disabled: server.disabled,
		timeout: server.timeout,
	}))
	return protoServers
}

/**
 * Converts McpTool to ProtoMcpTool format, ensuring all required fields have values
 */
function convertTool(tool: McpTool): ProtoMcpTool {
	const inputSchemaString = tool.inputSchema
		? typeof tool.inputSchema === "object"
			? JSON.stringify(tool.inputSchema)
			: tool.inputSchema
		: undefined

	return {
		name: tool.name,
		description: tool.description,
		inputSchema: inputSchemaString,
		autoApprove: tool.autoApprove,
	}
}

/**
 * Converts McpResource to ProtoMcpResource format, ensuring all required fields have values
 */
function convertResource(resource: McpResource): ProtoMcpResource {
	return {
		uri: resource.uri,
		name: resource.name,
		mimeType: resource.mimeType,
		description: resource.description,
	}
}

/**
 * Converts McpResourceTemplate to ProtoMcpResourceTemplate format, ensuring all required fields have values
 */
function convertResourceTemplate(template: McpResourceTemplate): ProtoMcpResourceTemplate {
	return {
		uriTemplate: template.uriTemplate,
		name: template.name,
		mimeType: template.mimeType,
		description: template.description,
	}
}

// Helper to convert Proto enum to TS status
function convertProtoStatusToMcp(status: McpServerStatus): McpServer["status"] {
	switch (status) {
		case McpServerStatus.MCP_SERVER_STATUS_CONNECTED:
			return "connected"
		case McpServerStatus.MCP_SERVER_STATUS_CONNECTING:
			return "connecting"
		case McpServerStatus.MCP_SERVER_STATUS_DISCONNECTED:
		default: // Includes UNSPECIFIED if it were present, maps to disconnected
			return "disconnected"
	}
}

export function convertProtoMcpServersToMcpServers(protoServers: ProtoMcpServer[]): McpServer[] {
	const mcpServers: McpServer[] = protoServers.map((protoServer) => {
		return {
			name: protoServer.name,
			config: protoServer.config,
			status: convertProtoStatusToMcp(protoServer.status),
			error: protoServer.error === "" ? undefined : protoServer.error,

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
