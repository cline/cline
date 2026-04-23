import { createDefaultExecutors, createMcpTools } from "@clinebot/core"
import { createTool, type Tool, type ToolContext } from "@clinebot/shared"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"

interface McpToolDescriptor {
	name: string
	description?: string
	inputSchema: Record<string, unknown>
}

class McpHubToolProvider {
	constructor(private readonly mcpHub: McpHub) {}

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
		}))
	}

	async callTool(request: {
		serverName: string
		toolName: string
		arguments?: Record<string, unknown>
		context?: ToolContext
	}): Promise<unknown> {
		const ulid = `sdk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
		return this.mcpHub.callTool(request.serverName, request.toolName, request.arguments ?? {}, ulid)
	}
}

/**
 * Lazily-created bash executor for attempt_completion commands.
 * Re-uses the SDK's built-in bash executor (via createDefaultExecutors) which
 * already handles cross-platform shells, timeout, abort signals, and output truncation.
 */
const getCompletionCommandExecutor = (() => {
	let executor: ReturnType<typeof createDefaultExecutors>["bash"] | undefined
	return () => {
		if (!executor) {
			const executors = createDefaultExecutors({
				bash: {
					timeoutMs: 15_000, // showcase commands, not long-running builds
					maxOutputBytes: 256_000,
				},
			})
			executor = executors.bash
		}
		return executor!
	}
})()

function createAttemptCompletionTool(options: { cwd?: string } = {}): Tool {
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
		execute: async (input: unknown, context: ToolContext) => {
			const parsedInput = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
			const resultText = typeof parsedInput.result === "string" ? parsedInput.result : "Task completed."
			const command = typeof parsedInput.command === "string" ? parsedInput.command.trim() : undefined

			if (!command) {
				return resultText
			}

			// Execute the command and include its output in the result
			const cwd = options.cwd || process.cwd()
			Logger.log(`[attempt_completion] Executing command: ${command} (cwd: ${cwd})`)

			try {
				const bashExecutor = getCompletionCommandExecutor()
				const commandOutput = await bashExecutor(command, cwd, context)
				const trimmedOutput = commandOutput.trim()

				if (trimmedOutput) {
					return `${resultText}\n\n[Command: ${command}]\n${trimmedOutput}`
				}
				return `${resultText}\n\n[Command executed: ${command}]`
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				Logger.warn(`[attempt_completion] Command failed: ${errorMsg}`)
				return `${resultText}\n\n[Command failed: ${command}]\n${errorMsg}`
			}
		},
	})
}

export async function createVscodeExtraTools(mcpHub: McpHub, options?: { cwd?: string }): Promise<Tool[]> {
	const provider = new McpHubToolProvider(mcpHub)
	const mcpTools = await Promise.all(
		mcpHub.getServers().map(async (server) => {
			try {
				return await createMcpTools({
					serverName: server.name,
					provider,
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

	const tools = [createAttemptCompletionTool({ cwd: options?.cwd }), ...mcpTools.flat()]
	Logger.log(`[VscodeRuntimeTools] Prepared ${tools.length} VSCode extra tools`)
	return tools
}
