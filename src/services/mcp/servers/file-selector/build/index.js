#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

class FileSelectorServer {
	server
	constructor() {
		this.server = new Server(
			{
				name: "file-selector-server",
				version: "0.1.0",
			},
			{
				capabilities: {
					tools: {},
				},
			},
		)
		// 注册工具列表请求处理器
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: [
					{
						name: "select_file",
						description: "Open VS Code file selection dialog to choose a file",
						inputSchema: {
							type: "object",
							properties: {
								canSelectMany: {
									type: "boolean",
									description: "Allow selecting multiple files",
								},
								canSelectFolders: {
									type: "boolean",
									description: "Allow selecting folders",
								},
								canSelectFiles: {
									type: "boolean",
									description: "Allow selecting files",
								},
								title: {
									type: "string",
									description: "Dialog title",
								},
							},
							required: [],
						},
					},
				],
			}
		})
		// 注册工具调用请求处理器
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			if (request.params.toolName === "select_file") {
				try {
					// 由于MCP服务器在独立进程中运行，无法直接调用VS Code API
					// 这里返回一个提示信息，说明需要通过Webview UI调用
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									message:
										"File selection requires VS Code integration. Please use the Cline Webview UI to select files.",
									requires_webview: true,
									tool_name: "select_file",
									arguments: request.params.arguments || {},
								}),
							},
						],
					}
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									canceled: true,
									error: error instanceof Error ? error.message : String(error),
								}),
							},
						],
						isError: true,
					}
				}
			}
			return {
				content: [
					{
						type: "text",
						text: `Unknown tool: ${request.params.toolName}`,
					},
				],
				isError: true,
			}
		})
	}
	async run() {
		const transport = new StdioServerTransport()
		await this.server.connect(transport)
		console.error("File Selector MCP server running on stdio")
	}
}
// 只有在作为主模块运行时才启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
	const server = new FileSelectorServer()
	server.run().catch(console.error)
}
