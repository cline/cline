import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { z } from "zod"
import { McpServer } from "@shared/mcp"
import { ServerConfigSchema } from "./schemas"

export type Transport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

export type McpConnection = {
	server: McpServer
	client: Client
	transport: Transport
}

export type McpTransportType = "stdio" | "sse" | "http"

export type McpServerConfig = z.infer<typeof ServerConfigSchema>
