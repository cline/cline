import * as http from "http"
import { spawn, type ChildProcess } from "child_process"
import { McpConcurrencyGuard } from "./mcp-concurrency-guard"

export interface ClineMcpToolHandlerProvider {
	isEnvironmentActive(): boolean
	readFile(params: { path: string }): Promise<{ success: boolean; content?: string; error?: string }>
	applyDiff(params: { path: string; diff: string }): Promise<{ success: boolean; diff?: string; error?: string }>
	writeFile(params: { path: string; content: string }): Promise<{ success: boolean; path?: string; error?: string }>
	runTerminal(params: { command: string }): Promise<{ success: boolean; exitCode?: number; output?: string; error?: string }>
	searchFiles(params: { query: string; path?: string }): Promise<{ success: boolean; results?: string[]; error?: string }>
	listFiles(params: { path: string }): Promise<{ success: boolean; files?: string[]; error?: string }>
	listCodeDefinitionNames?(params: { path: string }): Promise<{ success: boolean; definitions?: string[]; error?: string }>
	browserAction?(params: { action: string; url?: string; coordinate?: string; text?: string }): Promise<{ success: boolean; result?: string; error?: string }>
	webFetch?(params: { url: string }): Promise<{ success: boolean; content?: string; error?: string }>
	webSearch?(params: { query: string }): Promise<{ success: boolean; results?: unknown; error?: string }>
	askFollowupQuestion?(params: { question: string }): Promise<{ success: boolean; answer?: string; error?: string }>
	attemptCompletion?(params: { result: string }): Promise<{ success: boolean; output?: string; error?: string }>
	useMcpTool?(params: { server_name: string; tool_name: string; arguments?: Record<string, unknown> }): Promise<{ success: boolean; result?: unknown; error?: string }>
}

export interface ClineMcpServerOptions {
	port?: number
	host?: string
	handlerProvider: ClineMcpToolHandlerProvider
}

/**
 * Embedded MCP Server for Cline VS Code Extension.
 * Exposes Cline's tool handlers over HTTP / JSON-RPC 2.0 to external MCP agents.
 */
export class ClineMcpServer {
	private server: http.Server | null = null
	private readonly guard = new McpConcurrencyGuard()
	private readonly port: number
	private readonly host: string
	private readonly handlerProvider: ClineMcpToolHandlerProvider
	private ngrokProcess: ChildProcess | null = null
	private publicUrl: string | null = null

	constructor(options: ClineMcpServerOptions) {
		this.port = options.port ?? 3000
		this.host = options.host ?? "127.0.0.1"
		this.handlerProvider = options.handlerProvider
	}

	/**
	 * Starts a public ngrok tunnel exposing http://127.0.0.1:<port> over HTTPS.
	 */
	public async startNgrokTunnel(authtoken?: string): Promise<string> {
		if (this.publicUrl && this.ngrokProcess) {
			return this.publicUrl
		}

		if (authtoken) {
			const setAuth = spawn("npx", ["ngrok", "config", "add-authtoken", authtoken], { shell: true })
			await new Promise<void>((resolve) => setAuth.on("close", () => resolve()))
		}

		this.ngrokProcess = spawn("npx", ["ngrok", "http", String(this.port)], { shell: true })

		for (let i = 0; i < 20; i++) {
			await new Promise((resolve) => setTimeout(resolve, 500))
			try {
				const response = await fetch("http://127.0.0.1:4040/api/tunnels")
				if (response.ok) {
					const data = (await response.json()) as { tunnels?: Array<{ public_url?: string }> }
					const httpsTunnel = data.tunnels?.find((t) => t.public_url?.startsWith("https://")) ?? data.tunnels?.[0]
					if (httpsTunnel?.public_url) {
						this.publicUrl = `${httpsTunnel.public_url}/mcp`
						return this.publicUrl
					}
				}
			} catch {
				// Waiting for tunnel to start...
			}
		}

		throw new Error("Failed to start ngrok tunnel. Ensure ngrok or npx is installed.")
	}

	/**
	 * Stops the ngrok public tunnel.
	 */
	public async stopNgrokTunnel(): Promise<void> {
		if (this.ngrokProcess) {
			this.ngrokProcess.kill()
			this.ngrokProcess = null
		}
		this.publicUrl = null
	}

	public getPublicUrl(): string | undefined {
		return this.publicUrl ?? undefined
	}

	/**
	 * Starts the embedded MCP HTTP server.
	 */
	public async start(): Promise<void> {
		if (this.server) {
			return
		}

		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				this.handleRequest(req, res).catch((err) => {
					res.statusCode = 500
					res.setHeader("Content-Type", "application/json")
					res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
				})
			})

			this.server.on("error", (err) => {
				reject(err)
			})

			this.server.listen(this.port, this.host, () => {
				resolve()
			})
		})
	}

	/**
	 * Stops the embedded MCP HTTP server.
	 */
	public async stop(): Promise<void> {
		await this.stopNgrokTunnel()
		if (!this.server) {
			return
		}

		return new Promise((resolve) => {
			this.server?.close(() => {
				this.server = null
				resolve()
			})
		})
	}

	public get listening(): boolean {
		return this.server?.listening ?? false
	}

	public get getPort(): number {
		return this.port
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
		res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

		if (req.method === "OPTIONS") {
			res.statusCode = 204
			res.end()
			return
		}

		if (req.method === "GET" && (req.url === "/ping" || req.url === "/mcp" || req.url === "/")) {
			res.statusCode = 200
			res.setHeader("Content-Type", "application/json")
			res.end(
				JSON.stringify({
					status: "ok",
					name: "Cline MCP Server",
					endpoint: "http://127.0.0.1:" + this.port + "/mcp",
					protocol: "JSON-RPC 2.0 (POST)",
					active: this.handlerProvider.isEnvironmentActive(),
					port: this.port,
					message: "Cline MCP Server is running! Connect Hermes Agent or any MCP client to http://127.0.0.1:" + this.port + "/mcp using HTTP POST."
				}),
			)
			return
		}

		if (req.method === "POST" && (req.url === "/mcp" || req.url === "/jsonrpc")) {
			const body = await this.readBody(req)
			let jsonRpcReq: Record<string, unknown>
			try {
				jsonRpcReq = JSON.parse(body)
			} catch {
				res.statusCode = 400
				res.setHeader("Content-Type", "application/json")
				res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }))
				return
			}

			const response = await this.handleJsonRpcRequest(jsonRpcReq)
			res.statusCode = 200
			res.setHeader("Content-Type", "application/json")
			res.end(JSON.stringify(response))
			return
		}

		res.statusCode = 404
		res.setHeader("Content-Type", "application/json")
		res.end(JSON.stringify({ error: "Not Found" }))
	}

	private async handleJsonRpcRequest(req: Record<string, unknown>): Promise<Record<string, unknown>> {
		const id = req.id ?? null
		const method = req.method
		const params = (req.params as Record<string, unknown>) ?? {}

		if (!this.handlerProvider.isEnvironmentActive()) {
			return {
				jsonrpc: "2.0",
				id,
				error: {
					code: -32001,
					message: "Cline environment unavailable: VS Code or active session closed.",
				},
			}
		}

		if (method === "initialize") {
			return {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: (params.protocolVersion as string) || "2024-11-05",
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: "cline-mcp-server",
						version: "4.1.5",
					},
				},
			}
		}

		if (method === "notifications/initialized" || method === "initialized") {
			if (id === null) {
				return {}
			}
			return {
				jsonrpc: "2.0",
				id,
				result: {},
			}
		}

		if (method === "ping") {
			return {
				jsonrpc: "2.0",
				id,
				result: {},
			}
		}

		if (method === "tools/list") {
			return {
				jsonrpc: "2.0",
				id,
				result: {
					tools: [
						{
							name: "read_file",
							description: "Read contents of a workspace file",
							inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
						},
						{
							name: "apply_diff",
							description: "Apply a diff/patch to a file with VS Code preview",
							inputSchema: {
								type: "object",
								properties: { path: { type: "string" }, diff: { type: "string" } },
								required: ["path", "diff"],
							},
						},
						{
							name: "write_file",
							description: "Write content to a file",
							inputSchema: {
								type: "object",
								properties: { path: { type: "string" }, content: { type: "string" } },
								required: ["path", "content"],
							},
						},
						{
							name: "run_terminal",
							description: "Run a shell command in workspace terminal",
							inputSchema: {
								type: "object",
								properties: { command: { type: "string" } },
								required: ["command"],
							},
						},
						{
							name: "execute_command",
							description: "Alias for run_terminal (execute shell command)",
							inputSchema: {
								type: "object",
								properties: { command: { type: "string" } },
								required: ["command"],
							},
						},
						{
							name: "search_files",
							description: "Search workspace files by query string",
							inputSchema: {
								type: "object",
								properties: { query: { type: "string" }, path: { type: "string" } },
								required: ["query"],
							},
						},
						{
							name: "list_files",
							description: "List directory contents",
							inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
						},
						{
							name: "list_code_definition_names",
							description: "List top-level source code definitions in a file",
							inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
						},
						{
							name: "browser_action",
							description: "Perform browser automation actions (launch, click, type, screenshot)",
							inputSchema: {
								type: "object",
								properties: {
									action: { type: "string" },
									url: { type: "string" },
									coordinate: { type: "string" },
									text: { type: "string" },
								},
								required: ["action"],
							},
						},
						{
							name: "web_fetch",
							description: "Fetch web URL page content",
							inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
						},
						{
							name: "web_search",
							description: "Search the web using search engine",
							inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
						},
						{
							name: "ask_followup_question",
							description: "Ask user a follow-up question in VS Code UI",
							inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
						},
						{
							name: "attempt_completion",
							description: "Signal task completion to user",
							inputSchema: { type: "object", properties: { result: { type: "string" } }, required: ["result"] },
						},
						{
							name: "use_mcp_tool",
							description: "Call a tool from an installed MCP server inside Cline",
							inputSchema: {
								type: "object",
								properties: {
									server_name: { type: "string" },
									tool_name: { type: "string" },
									arguments: { type: "object" },
								},
								required: ["server_name", "tool_name"],
							},
						},
					],
				},
			}
		}

		if (method === "tools/call") {
			const name = params.name as string
			const args = (params.arguments as Record<string, unknown>) ?? {}

			return this.guard.runExclusive(async () => {
				try {
					let result: unknown
					switch (name) {
						case "read_file":
							result = await this.handlerProvider.readFile({ path: String(args.path ?? "") })
							break
						case "apply_diff":
						case "replace_in_file":
						case "apply_patch":
							result = await this.handlerProvider.applyDiff({
								path: String(args.path ?? ""),
								diff: String(args.diff ?? args.content ?? ""),
							})
							break
						case "write_file":
						case "write_to_file":
							result = await this.handlerProvider.writeFile({
								path: String(args.path ?? ""),
								content: String(args.content ?? ""),
							})
							break
						case "run_terminal":
						case "execute_command":
							result = await this.handlerProvider.runTerminal({ command: String(args.command ?? "") })
							break
						case "search_files":
							result = await this.handlerProvider.searchFiles({
								query: String(args.query ?? ""),
								path: args.path ? String(args.path) : undefined,
							})
							break
						case "list_files":
							result = await this.handlerProvider.listFiles({ path: String(args.path ?? "") })
							break
						case "list_code_definition_names":
							result = this.handlerProvider.listCodeDefinitionNames
								? await this.handlerProvider.listCodeDefinitionNames({ path: String(args.path ?? "") })
								: { success: true, definitions: [] }
							break
						case "browser_action":
							result = this.handlerProvider.browserAction
								? await this.handlerProvider.browserAction({
										action: String(args.action ?? ""),
										url: args.url ? String(args.url) : undefined,
										coordinate: args.coordinate ? String(args.coordinate) : undefined,
										text: args.text ? String(args.text) : undefined,
									})
								: { success: true, result: "Browser action executed" }
							break
						case "web_fetch":
							result = this.handlerProvider.webFetch
								? await this.handlerProvider.webFetch({ url: String(args.url ?? "") })
								: { success: true, content: "" }
							break
						case "web_search":
							result = this.handlerProvider.webSearch
								? await this.handlerProvider.webSearch({ query: String(args.query ?? "") })
								: { success: true, results: [] }
							break
						case "ask_followup_question":
							result = this.handlerProvider.askFollowupQuestion
								? await this.handlerProvider.askFollowupQuestion({ question: String(args.question ?? "") })
								: { success: true, answer: "Question asked in VS Code UI" }
							break
						case "attempt_completion":
							result = this.handlerProvider.attemptCompletion
								? await this.handlerProvider.attemptCompletion({ result: String(args.result ?? "") })
								: { success: true, output: "Task completed" }
							break
						case "use_mcp_tool":
							result = this.handlerProvider.useMcpTool
								? await this.handlerProvider.useMcpTool({
										server_name: String(args.server_name ?? ""),
										tool_name: String(args.tool_name ?? ""),
										arguments: (args.arguments as Record<string, unknown>) ?? {},
									})
								: { success: true, result: null }
							break
						default:
							return {
								jsonrpc: "2.0",
								id,
								error: { code: -32601, message: `Tool not found: ${name}` },
							}
					}

					const rawResult = result as Record<string, unknown> | string
					const isError = typeof rawResult === "object" && rawResult !== null && rawResult.success === false
					const text = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult, null, 2)

					const extraFields = typeof rawResult === "object" && rawResult !== null ? { ...rawResult } : {}
					delete (extraFields as Record<string, unknown>).content

					return {
						jsonrpc: "2.0",
						id,
						result: {
							...extraFields,
							content: [
								{
									type: "text",
									text,
								},
							],
							isError,
						},
					}
				} catch (err) {
					return {
						jsonrpc: "2.0",
						id,
						error: {
							code: -32603,
							message: err instanceof Error ? err.message : String(err),
						},
					}
				}
			})
		}

		return {
			jsonrpc: "2.0",
			id,
			error: { code: -32601, message: `Method not found: ${String(method)}` },
		}
	}

	private readBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let data = ""
			req.on("data", (chunk) => {
				data += chunk
			})
			req.on("end", () => {
				resolve(data)
			})
			req.on("error", (err) => {
				reject(err)
			})
		})
	}
}
