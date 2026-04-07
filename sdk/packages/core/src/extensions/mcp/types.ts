import type { ToolContext } from "@clinebot/shared";

export interface McpToolDescriptor {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface McpToolCallRequest {
	serverName: string;
	toolName: string;
	arguments?: Record<string, unknown>;
	context?: ToolContext;
}

export type McpToolCallResult = unknown;

export interface McpToolProvider {
	listTools(serverName: string): Promise<readonly McpToolDescriptor[]>;
	callTool(request: McpToolCallRequest): Promise<McpToolCallResult>;
}

export type McpToolNameTransform = (input: {
	serverName: string;
	toolName: string;
}) => string;

export interface CreateMcpToolsOptions {
	serverName: string;
	provider: McpToolProvider;
	nameTransform?: McpToolNameTransform;
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}

export type McpConnectionStatus = "disconnected" | "connecting" | "connected";

export interface McpStdioTransportConfig {
	type: "stdio";
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export interface McpSseTransportConfig {
	type: "sse";
	url: string;
	headers?: Record<string, string>;
}

export interface McpStreamableHttpTransportConfig {
	type: "streamableHttp";
	url: string;
	headers?: Record<string, string>;
}

export type McpServerTransportConfig =
	| McpStdioTransportConfig
	| McpSseTransportConfig
	| McpStreamableHttpTransportConfig;

export interface McpServerRegistration {
	name: string;
	transport: McpServerTransportConfig;
	disabled?: boolean;
	metadata?: Record<string, unknown>;
}

export interface McpServerSnapshot {
	name: string;
	status: McpConnectionStatus;
	disabled: boolean;
	lastError?: string;
	toolCount: number;
	updatedAt: number;
	metadata?: Record<string, unknown>;
}

export interface McpServerClient {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	listTools(): Promise<readonly McpToolDescriptor[]>;
	callTool(request: {
		name: string;
		arguments?: Record<string, unknown>;
		context?: ToolContext;
	}): Promise<McpToolCallResult>;
}

export type McpServerClientFactory = (
	registration: McpServerRegistration,
) => Promise<McpServerClient> | McpServerClient;

export interface McpManagerOptions {
	clientFactory: McpServerClientFactory;
	/**
	 * Cache TTL for tools/list responses.
	 * A short cache avoids repeated list requests while keeping server metadata fresh.
	 * @default 5000
	 */
	toolsCacheTtlMs?: number;
}

export interface McpManager extends McpToolProvider {
	registerServer(registration: McpServerRegistration): Promise<void>;
	unregisterServer(serverName: string): Promise<void>;
	connectServer(serverName: string): Promise<void>;
	disconnectServer(serverName: string): Promise<void>;
	setServerDisabled(serverName: string, disabled: boolean): Promise<void>;
	listServers(): readonly McpServerSnapshot[];
	refreshTools(serverName: string): Promise<readonly McpToolDescriptor[]>;
	callTool(request: McpToolCallRequest): Promise<McpToolCallResult>;
	dispose(): Promise<void>;
}
