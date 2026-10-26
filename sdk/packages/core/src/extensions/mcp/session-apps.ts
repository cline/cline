import {
	getMcpAppToolMeta,
	isMcpAppResourceUri,
	isMcpToolVisibleToApp,
	isMcpToolVisibleToModel,
} from "./apps";
import { defaultMcpToolNameTransform } from "./name-transform";
import type {
	McpManager,
	McpResourceReadResult,
	McpToolCallResult,
	McpToolDescriptor,
	McpToolNameTransform,
} from "./types";

export interface McpAppToolBinding {
	serverName: string;
	toolName: string;
	resourceUri: string;
}

export interface McpAppResourceReadRequest {
	serverName: string;
	uri: string;
}

export interface McpAppToolCallRequest {
	serverName: string;
	toolName: string;
	arguments?: Record<string, unknown>;
}

export interface McpAppsRuntime {
	resolveTool(agentToolName: string): Promise<McpAppToolBinding | undefined>;
	readResource(
		request: McpAppResourceReadRequest,
	): Promise<McpResourceReadResult>;
	callTool(request: McpAppToolCallRequest): Promise<McpToolCallResult>;
}

export interface CreateMcpAppsRuntimeOptions {
	manager: Pick<McpManager, "listTools" | "callTool" | "readResource">;
	serverNames: readonly string[];
	agentTools: ReadonlyMap<string, readonly McpToolDescriptor[]>;
	nameTransform?: McpToolNameTransform;
	isToolEnabled?: (agentToolName: string) => boolean;
}

export function createMcpAppsRuntime(
	options: CreateMcpAppsRuntimeOptions,
): McpAppsRuntime {
	const serverNames = new Set(options.serverNames);
	const nameTransform = options.nameTransform ?? defaultMcpToolNameTransform;
	const appToolBindings = new Map<string, McpAppToolBinding | undefined>();
	for (const [serverName, descriptors] of options.agentTools) {
		for (const descriptor of descriptors.filter(isMcpToolVisibleToModel)) {
			const resourceUri = getMcpAppToolMeta(descriptor)?.resourceUri;
			appToolBindings.set(
				nameTransform({ serverName, toolName: descriptor.name }),
				resourceUri
					? { serverName, toolName: descriptor.name, resourceUri }
					: undefined,
			);
		}
	}

	function requireServer(serverName: string): void {
		if (!serverNames.has(serverName)) {
			throw new Error(
				`MCP server "${serverName}" is not available in this session.`,
			);
		}
	}

	async function findDescriptor(
		serverName: string,
		toolName: string,
	): Promise<McpToolDescriptor | undefined> {
		const descriptors = await options.manager.listTools(serverName);
		return descriptors.find((descriptor) => descriptor.name === toolName);
	}

	return {
		async resolveTool(agentToolName) {
			return appToolBindings.get(agentToolName);
		},

		async readResource(request) {
			requireServer(request.serverName);
			if (!isMcpAppResourceUri(request.uri)) {
				throw new Error(
					`MCP Apps can only read ui:// resources, not "${request.uri}".`,
				);
			}
			if (!options.manager.readResource) {
				throw new Error("MCP resource reads are not supported.");
			}
			return options.manager.readResource({
				serverName: request.serverName,
				uri: request.uri,
			});
		},

		async callTool(request) {
			requireServer(request.serverName);
			const descriptor = await findDescriptor(
				request.serverName,
				request.toolName,
			);
			if (!descriptor) {
				throw new Error(
					`MCP tool "${request.toolName}" was not found on server "${request.serverName}".`,
				);
			}
			if (!isMcpToolVisibleToApp(descriptor)) {
				throw new Error(
					`MCP tool "${request.toolName}" on server "${request.serverName}" cannot be called by an app.`,
				);
			}
			if (
				options.isToolEnabled &&
				!options.isToolEnabled(
					nameTransform({
						serverName: request.serverName,
						toolName: request.toolName,
					}),
				)
			) {
				throw new Error(
					`MCP tool "${request.toolName}" on server "${request.serverName}" is disabled for this session.`,
				);
			}
			return options.manager.callTool({
				serverName: request.serverName,
				toolName: request.toolName,
				arguments: request.arguments,
			});
		},
	};
}
