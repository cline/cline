import type { AgentToolContext } from "@cline/shared";

export interface McpToolDescriptor {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface McpToolCallRequest {
	serverName: string;
	toolName: string;
	arguments?: Record<string, unknown>;
	context?: AgentToolContext;
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

export interface McpServerOAuthState {
	clientInformation?: Record<string, unknown>;
	tokens?: Record<string, unknown>;
	codeVerifier?: string;
	discoveryState?: Record<string, unknown>;
	redirectUrl?: string;
	lastError?: string;
	lastAuthenticatedAt?: number;
	authorizationRequired?: boolean;
}

export interface McpServerOAuthClientConfig {
	clientId: string;
	clientSecret?: string;
}

export interface McpServerRegistration {
	name: string;
	transport: McpServerTransportConfig;
	disabled?: boolean;
	/**
	 * Per-server request timeout in seconds, from the `timeout` field in
	 * cline_mcp_settings.json. Undefined means the shared default for ordinary
	 * requests; the stdio client uses its default connect budget for
	 * initialize until a finite timeout is explicitly configured. Registrations are
	 * resolved when the runtime is built, so changes take effect on the next
	 * session.
	 */
	timeoutSeconds?: number;
	metadata?: Record<string, unknown>;
	oauthClient?: McpServerOAuthClientConfig;
	oauth?: McpServerOAuthState;
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

export type McpToolsChangedHandler = () => void;

export interface McpServerClient {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	listTools(): Promise<readonly McpToolDescriptor[]>;
	callTool(request: {
		name: string;
		arguments?: Record<string, unknown>;
		context?: AgentToolContext;
	}): Promise<McpToolCallResult>;
	/**
	 * Register the handler invoked when the server signals that its tool
	 * list changed (`notifications/tools/list_changed`). Optional: clients
	 * that do not observe server notifications simply omit it.
	 */
	onToolsChanged?(handler: McpToolsChangedHandler): void;
}

export type McpServerClientFactory = (
	registration: McpServerRegistration,
) => Promise<McpServerClient> | McpServerClient;

export interface McpServerOAuthStatus {
	serverName: string;
	oauthSupported: boolean;
	oauthConfigured: boolean;
	authorizationRequired: boolean;
	lastError?: string;
	lastAuthenticatedAt?: number;
}

export interface McpManagerOptions {
	clientFactory: McpServerClientFactory;
	/**
	 * Cache TTL for tools/list responses.
	 * A short cache avoids repeated list requests while keeping server metadata fresh.
	 * @default 5000
	 */
	toolsCacheTtlMs?: number;
	/**
	 * Invoked when a connected server signals that its tool list changed
	 * (`notifications/tools/list_changed`). The manager has already
	 * invalidated that server's cached tool list when this fires, so the
	 * next `listTools` re-lists; hosts use this to refresh eagerly.
	 */
	onToolsChanged?: (serverName: string) => void;
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
