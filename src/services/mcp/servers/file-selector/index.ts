#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import * as vscode from "vscode"

interface FileSelectorResponse {
	filePath?: string
	canceled: boolean
	error?: string
}

class FileSelectorServer {
	private server: Server

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
								filters: {
									type: "object",
									description: "File filters",
									additionalProperties: {
										type: "array",
										items: {
											type: "string",
										},
									},
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
					const result = await this.selectFile(request.params.arguments || {})
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result),
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

	private async selectFile(options: any): Promise<FileSelectorResponse> {
		try {
			// 构建文件选择对话框选项
			const dialogOptions: vscode.OpenDialogOptions = {
				canSelectMany: options.canSelectMany || false,
				canSelectFolders: options.canSelectFolders || false,
				canSelectFiles: options.canSelectFiles !== undefined ? options.canSelectFiles : true,
				title: options.title || "Select File",
			}

			// 处理文件过滤器
			if (options.filters) {
				dialogOptions.filters = options.filters
			}

			// 使用VS Code API打开文件选择对话框
			const result = await vscode.window.showOpenDialog(dialogOptions)

			if (result && result.length > 0) {
				// 返回第一个选择的文件路径
				return {
					filePath: result[0].fsPath,
					canceled: false,
				}
			} else {
				// 用户取消了选择
				return {
					canceled: true,
				}
			}
		} catch (error) {
			return {
				canceled: true,
				error: error instanceof Error ? error.message : String(error),
			}
		}
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
