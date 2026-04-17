// Custom RuntimeBuilder that bridges the classic McpHub to the SDK's tool system.
//
// The SDK's DefaultRuntimeBuilder.loadConfiguredMcpTools() creates an
// InMemoryMcpManager with createDefaultMcpServerClientFactory() which only
// supports stdio transport. This custom builder instead reads MCP tools from
// the classic McpHub, which already supports all three transports (stdio,
// SSE, streamableHttp) and provides file watching, dynamic connect/disconnect,
// and server status UI.
//
// Architecture:
//   VscodeRuntimeBuilder
//     ├── Builtin tools: delegates to DefaultRuntimeBuilder
//     └── MCP tools: reads from classic McpHub via McpHubToolProvider
//
// Future: When the SDK's InMemoryMcpManager supports all transports, this
// can be replaced with the default builder. See PROBLEMS.md S6-10.

import { DefaultRuntimeBuilder } from "@clinebot/core"
import { createTool, type Tool, type ToolContext } from "@clinebot/shared"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"

// ---------------------------------------------------------------------------
// McpHub → SDK McpToolProvider adapter
// ---------------------------------------------------------------------------

/**
 * Adapter that makes the classic McpHub look like an SDK McpToolProvider.
 *
 * The SDK's createMcpTools() expects a provider with listTools() and callTool()
 * methods. This adapter delegates those calls to the classic McpHub, which
 * already has connected MCP servers with all transport types.
 */
class McpHubToolProvider {
	constructor(private mcpHub: McpHub) {}

	/**
	 * List tools for a given MCP server by reading from the classic McpHub.
	 */
	async listTools(serverName: string): Promise<readonly McpToolDescriptor[]> {
		const servers = this.mcpHub.getServers()
		const server = servers.find((s) => s.name === serverName)
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
		}))
	}

	/**
	 * Call a tool on an MCP server via the classic McpHub.
	 */
	async callTool(request: {
		serverName: string
		toolName: string
		arguments?: Record<string, unknown>
		context?: ToolContext
	}): Promise<unknown> {
		// McpHub.callTool requires a ulid (unique log identifier) for tracking.
		// Generate a simple unique ID since we don't need cross-reference tracking.
		const ulid = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		const result = await this.mcpHub.callTool(request.serverName, request.toolName, request.arguments ?? {}, ulid)
		return result
	}
}

/** Minimal tool descriptor matching the SDK's McpToolDescriptor */
interface McpToolDescriptor {
	name: string
	description?: string
	inputSchema: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// MCP tool name transform (matches SDK's defaultMcpToolNameTransform)
// ---------------------------------------------------------------------------

/**
 * Transform MCP server+tool names into a single agent tool name.
 * Format: `serverName__toolName` (double underscore separator).
 * This matches the SDK's defaultMcpToolNameTransform.
 */
function mcpToolNameTransform(input: { serverName: string; toolName: string }): string {
	return `${input.serverName}__${input.toolName}`
}

// ---------------------------------------------------------------------------
// attempt_completion tool
// ---------------------------------------------------------------------------

/**
 * Create the attempt_completion tool for the SDK agent.
 *
 * In the classic extension, attempt_completion was a built-in tool that
 * triggered the green "Task Completed" rectangle in the webview. The SDK
 * doesn't have this tool built-in, so we register it as a custom tool.
 *
 * The tool's execute function is a no-op — it just returns a success
 * message. The actual UI behavior (green rectangle, follow-up input) is
 * handled by the message translator when it sees content_start/content_end
 * events with toolName === "attempt_completion".
 */
function createAttemptCompletionTool(): Tool {
	return createTool({
		name: "attempt_completion",
		description:
			"Once you've completed the user's task, use this tool to present the result to the user. " +
			"The user may provide feedback if they are not satisfied, which you can use to make improvements and try again.",
		inputSchema: {
			type: "object",
			properties: {
				result: {
					type: "string",
					description: "A clear, brief summary of the final result of the task.",
				},
				command: {
					type: "string",
					description:
						"An optional terminal command to showcase the result (e.g. open a dev server). " +
						"Do not use commands like echo or cat that merely print text.",
				},
			},
			required: ["result"],
		},
		execute: async (input: unknown) => {
			// No-op: the message translator handles the UI display.
			// We return the result text so it appears in the agent event stream.
			const parsedInput = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
			const result = typeof parsedInput.result === "string" ? parsedInput.result : "Task completed."
			return result
		},
	})
}

// ---------------------------------------------------------------------------
// VscodeRuntimeBuilder
// ---------------------------------------------------------------------------

/**
 * Custom RuntimeBuilder for the VSCode extension that uses the classic
 * McpHub for MCP tool management instead of the SDK's InMemoryMcpManager.
 *
 * This builder:
 * 1. Delegates to DefaultRuntimeBuilder for builtin tools (editor, bash, etc.)
 * 2. Reads MCP tools from the classic McpHub's already-connected servers
 * 3. Creates SDK Tool objects that call through to McpHub.callTool()
 *
 * Benefits over the SDK's default MCP loading:
 * - Supports all transport types (stdio, SSE, streamableHttp)
 * - Uses already-connected servers (no duplicate connections)
 * - File watching and dynamic connect/disconnect work via McpHub
 * - Server status is visible in the webview UI
 *
 * Usage:
 * ```ts
 * const runtimeBuilder = new VscodeRuntimeBuilder(mcpHub)
 * // Pass to DefaultSessionManager constructor:
 * // new DefaultSessionManager({ runtimeBuilder, ... })
 * ```
 */
export class VscodeRuntimeBuilder {
	private defaultBuilder: DefaultRuntimeBuilder
	private mcpHub: McpHub

	constructor(mcpHub: McpHub) {
		this.mcpHub = mcpHub
		this.defaultBuilder = new DefaultRuntimeBuilder()
	}

	/**
	 * Build the runtime tools for a session.
	 *
	 * Delegates to DefaultRuntimeBuilder for builtin tools, then adds
	 * MCP tools from the classic McpHub's connected servers, plus the
	 * attempt_completion tool for task completion UI.
	 */
	async build(input: Parameters<DefaultRuntimeBuilder["build"]>[0]) {
		// 1. Build builtin tools using the default builder
		const defaultRuntime = await this.defaultBuilder.build(input)

		// 2. Remove any MCP tools that the default builder may have loaded
		//    (from the filtered settings file). We'll replace them with
		//    tools from the classic McpHub.
		const builtinTools = defaultRuntime.tools.filter(
			(tool) => !tool.name.includes("__"), // MCP tools use serverName__toolName format
		)

		// 3. Load MCP tools from the classic McpHub
		const mcpTools = await this.loadMcpToolsFromHub()

		// 4. Create the attempt_completion tool
		const completionTool = createAttemptCompletionTool()

		// 5. Combine
		const allTools = [...builtinTools, completionTool, ...mcpTools]

		Logger.log(
			`[VscodeRuntimeBuilder] Built runtime: ${builtinTools.length} builtin + 1 completion + ${mcpTools.length} MCP tools`,
		)

		return {
			...defaultRuntime,
			tools: allTools,
			shutdown: async (reason: string) => {
				await defaultRuntime.shutdown(reason)
			},
		}
	}

	/**
	 * Load MCP tools from the classic McpHub's connected servers.
	 *
	 * For each connected server, we list its tools and create SDK Tool
	 * objects that delegate calls to McpHub.callTool(). This gives the
	 * SDK agent access to all MCP servers regardless of transport type.
	 */
	private async loadMcpToolsFromHub(): Promise<Tool[]> {
		const tools: Tool[] = []
		const provider = new McpHubToolProvider(this.mcpHub)

		const servers = this.mcpHub.getServers()
		for (const server of servers) {
			if (server.disabled) {
				continue
			}

			try {
				const descriptors = await provider.listTools(server.name)
				for (const descriptor of descriptors) {
					const agentToolName = mcpToolNameTransform({
						serverName: server.name,
						toolName: descriptor.name,
					})

					const tool = createTool({
						name: agentToolName,
						description:
							descriptor.description ?? `Execute MCP tool "${descriptor.name}" from server "${server.name}".`,
						inputSchema: descriptor.inputSchema,
						execute: async (input: unknown, context: ToolContext) => {
							const args =
								input && typeof input === "object" && !Array.isArray(input)
									? (input as Record<string, unknown>)
									: undefined
							return provider.callTool({
								serverName: server.name,
								toolName: descriptor.name,
								arguments: args,
								context,
							})
						},
					})

					tools.push(tool)
				}
			} catch (error) {
				Logger.warn(`[VscodeRuntimeBuilder] Failed to load tools from MCP server "${server.name}": ${error}`)
			}
		}

		return tools
	}
}
