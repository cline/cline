import { createMcpTools, type McpResourceReadResult, type McpToolAnnotations } from "@cline/core"
import type { AgentMode, AgentTool, AgentToolContext } from "@cline/shared"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import type { McpHub } from "@/services/mcp/McpHub"
import { resolveMcpServerTimeoutMs } from "@/services/mcp/timeout"
import { Logger } from "@/shared/services/Logger"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import { createVscodeRunCommandsTool, VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS } from "./vscode-run-commands-tool"

interface McpToolDescriptor {
	name: string
	description?: string
	inputSchema: Record<string, unknown>
	annotations?: McpToolAnnotations
	_meta?: Record<string, unknown>
}

export interface McpHubToolProviderOptions {
	/** Session mode the tools are built for; stamped on tool-call telemetry. */
	mode?: AgentMode
}

export class McpHubToolProvider {
	constructor(
		private readonly mcpHub: McpHub,
		private readonly options: McpHubToolProviderOptions = {},
	) {}

	async listTools(serverName: string): Promise<readonly McpToolDescriptor[]> {
		const servers = this.mcpHub.getServers()
		const server = servers.find((entry) => entry.name === serverName)
		if (!server) {
			Logger.warn(`[McpHubToolProvider] Server not found: ${serverName}`)
			return []
		}

		return (server.tools ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description ?? undefined,
			inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
				type: "object",
				properties: {},
			},
			...(tool.annotations ? { annotations: tool.annotations } : {}),
			...(tool._meta ? { _meta: tool._meta } : {}),
		}))
	}

	async callTool(request: {
		serverName: string
		toolName: string
		arguments?: Record<string, unknown>
		context?: AgentToolContext
	}): Promise<unknown> {
		const ulid = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		return this.mcpHub.callTool(
			request.serverName,
			request.toolName,
			request.arguments ?? {},
			ulid,
			request.context?.signal,
			this.options.mode,
		)
	}

	async readResource(request: { serverName: string; uri: string; context?: AgentToolContext }): Promise<McpResourceReadResult> {
		return this.mcpHub.readResource(request.serverName, request.uri, request.context?.signal)
	}
}

export interface VscodeExtraToolsOptions {
	cwd?: string
	/** Session mode the tools are built for; a mode switch rebuilds the session. */
	mode?: AgentMode
	/**
	 * Lazy factory for the VscodeTerminalManager.
	 * When provided, the custom `run_commands` tool replaces the SDK's
	 * built-in version with foreground/background terminal support.
	 */
	getTerminalManager?: () => VscodeTerminalManager
	/** Current VS Code terminal execution mode, captured when the session tools are built. */
	vscodeTerminalExecutionMode?: "vscodeTerminal" | "backgroundExec"
	/** Registry of in-flight foreground executions for "Proceed While Running". */
	foregroundCommands?: SdkForegroundCommandCoordinator
}

export async function createVscodeExtraTools(mcpHub: McpHub, options?: VscodeExtraToolsOptions): Promise<AgentTool[]> {
	const provider = new McpHubToolProvider(mcpHub, { mode: options?.mode })
	const mcpTools = await Promise.all(
		mcpHub.getServers().map(async (server) => {
			try {
				return await createMcpTools({
					serverName: server.name,
					provider,
					// Keep the tool wrapper timeout in agreement with the MCP
					// request timeout: both derive from the server's config.
					timeoutMs: resolveMcpServerTimeoutMs(server.config),
				})
			} catch (error) {
				Logger.warn(
					`[VscodeRuntimeTools] Failed to load tools from MCP server "${server.name}": ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
				return []
			}
		}),
	)

	// No completion tool is exposed: the agent simply ends its turn with a text
	// response, and the turn-end inference in message-translator.ts styles that
	// final text as the completion feedback row.
	const tools: AgentTool[] = [...mcpTools.flat()]

	// Add the custom run_commands tool when a terminal manager is available.
	// This replaces the SDK's built-in run_commands, which is suppressed via
	// tool executor capabilities in VscodeSessionHost.
	if (options?.getTerminalManager) {
		const executionMode = options.vscodeTerminalExecutionMode ?? "vscodeTerminal"
		tools.push(
			createVscodeRunCommandsTool({
				cwd: options.cwd ?? process.cwd(),
				getTerminalManager: options.getTerminalManager,
				bashTimeoutMs: executionMode === "vscodeTerminal" ? VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS : undefined,
				vscodeTerminalExecutionMode: executionMode,
				foregroundCommands: options.foregroundCommands,
			}),
		)
		Logger.log(
			`[VscodeRuntimeTools] Added custom run_commands tool (mode=${executionMode}, timeoutMs=${executionMode === "vscodeTerminal" ? VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS : "default"})`,
		)
	}

	Logger.log(`[VscodeRuntimeTools] Prepared ${tools.length} VSCode extra tools`)
	return tools
}
