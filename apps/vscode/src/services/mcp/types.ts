import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { McpServer } from "@shared/mcp"
import { z } from "zod"
import { ServerConfigSchema } from "./schemas"

export type Transport = StdioClientTransport

export type McpConnection = {
	server: McpServer
	client: Client
	transport: Transport
}

export type McpServerConfig = z.infer<typeof ServerConfigSchema>
