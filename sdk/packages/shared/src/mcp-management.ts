/** Machine-local MCP configuration exposed by the shared Hub. OAuth secrets are omitted. */
export interface McpServerConfigView {
	name: string;
	transportType: "stdio" | "sse" | "streamableHttp";
	disabled: boolean;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	metadata?: Record<string, unknown>;
	configurationError?: string;
	oauthStatus?: {
		supported: boolean;
		configured: boolean;
		authorizationRequired: boolean;
		lastError?: string;
		lastAuthenticatedAt?: number;
	};
}
export interface McpServersResponse {
	settingsPath: string;
	hasSettingsFile: boolean;
	servers: McpServerConfigView[];
}
export type McpServerConfigInput = {
	name: string;
	previousName?: string;
	disabled?: boolean;
	metadata?: Record<string, unknown>;
} & (
	| {
			transportType: "stdio";
			command: string;
			args?: string[];
			cwd?: string;
			env?: Record<string, string>;
	  }
	| {
			transportType: "sse" | "streamableHttp";
			url: string;
			headers?: Record<string, string>;
	  }
);
export interface McpServerInspection {
	name: string;
	connected: boolean;
	error?: string;
	tools: { name: string; description?: string; inputSchema?: unknown }[];
}
