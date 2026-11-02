/**
 * MCP server definitions that a host can hand to a session at start time.
 *
 * They exist so a client surface (CLI/ACP, hub, SDK) can supply MCP servers for
 * a single session — with per-session URLs, credentials and lifetimes — without
 * writing them into `cline_mcp_settings.json`.
 */

export interface SessionMcpStdioTransport {
	type: "stdio";
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export interface SessionMcpSseTransport {
	type: "sse";
	url: string;
	headers?: Record<string, string>;
}

export interface SessionMcpStreamableHttpTransport {
	type: "streamableHttp";
	url: string;
	headers?: Record<string, string>;
}

export type SessionMcpTransport =
	| SessionMcpStdioTransport
	| SessionMcpSseTransport
	| SessionMcpStreamableHttpTransport;

export interface SessionMcpServerConfig {
	name: string;
	transport: SessionMcpTransport;
	disabled?: boolean;
	/** Per-server request timeout in seconds. */
	timeoutSeconds?: number;
}
