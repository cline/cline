import type { ToolContext } from "../types";

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

/**
 * Minimal MCP capability contract required by the agent package.
 *
 * Implementations can be local, remote, cached, persistent, or fully managed by
 * another package (for example, @clinebot/core).
 */
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
