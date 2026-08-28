import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { McpServer } from "@shared/mcp"
import type { z } from "zod"
import { ServerConfigSchema } from "./schemas"

export type Transport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

export type McpConnection = {
	server: McpServer
	client: Client
	transport: Transport
	authProvider?: OAuthClientProvider
	/**
	 * Full connection config retained only inside the extension host. This may
	 * contain credentials and must never be serialized to the webview, logs, or
	 * protobuf state. `server.config` is the redacted display representation.
	 */
	configSnapshot?: McpServerConfig
}

export type McpServerConfig = z.infer<typeof ServerConfigSchema>
