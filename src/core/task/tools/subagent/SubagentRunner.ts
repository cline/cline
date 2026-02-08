import { setTimeout as delay } from "node:timers/promises"
import { buildApiHandler } from "@core/api"
import { ToolUse } from "@core/assistant-message"
import { discoverSkills, getAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import { formatResponse } from "@core/prompts/responses"
import { PromptRegistry } from "@core/prompts/system-prompt"
import { ClineToolSet } from "@core/prompts/system-prompt/registry/ClineToolSet"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { StreamResponseHandler } from "@core/task/StreamResponseHandler"
import { ClineStorageMessage, ClineTextContentBlock } from "@shared/messages"
import { Logger } from "@shared/services/Logger"
import { ClineDefaultTool } from "@shared/tools"
import { HostProvider } from "@/hosts/host-provider"
import { TaskState } from "../../TaskState"
import type { TaskConfig } from "../types/TaskConfig"

const SUBAGENT_ALLOWED_TOOLS: ClineDefaultTool[] = [
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.BASH,
	ClineDefaultTool.USE_SKILL,
]

export type SubagentRunStatus = "completed" | "failed"

export interface SubagentRunResult {
	status: SubagentRunStatus
	result?: string
	error?: string
	stats: SubagentRunStats
}

interface SubagentProgressUpdate {
	stats?: SubagentRunStats
	status?: "running" | "completed" | "failed"
	result?: string
	error?: string
}

interface SubagentRunStats {
	toolCalls: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
}

const SUBAGENT_SYSTEM_SUFFIX = `\n\n# Subagent Execution Mode
You are running as a research subagent. Your job is to thoroughly explore the codebase and gather comprehensive information to answer the question.
Explore broadly, read related files, trace through call chains, and build a complete picture before reporting back.
You can read files, list directories, search for patterns, list code definitions, and run commands.
Only use execute_command for readonly operations like ls, grep, git log, git diff, gh, etc.
Do not run commands that modify files or system state.
When you have a comprehensive answer, respond with your findings including file paths and line numbers.`

function serializeToolResult(result: unknown): string {
	if (typeof result === "string") {
		return result
	}

	if (Array.isArray(result)) {
		return result
			.map((item) => {
				if (!item || typeof item !== "object") {
					return String(item)
				}

				const maybeText = (item as { text?: string }).text
				if (typeof maybeText === "string") {
					return maybeText
				}

				return JSON.stringify(item)
			})
			.join("\n")
	}

	return JSON.stringify(result, null, 2)
}

function toToolUseParams(input: unknown): Partial<Record<string, string>> {
	if (!input || typeof input !== "object") {
		return {}
	}

	const params: Record<string, string> = {}
	for (const [key, value] of Object.entries(input)) {
		params[key] = typeof value === "string" ? value : JSON.stringify(value)
	}

	return params
}

function normalizeToolCallArguments(argumentsPayload: unknown): string {
	if (typeof argumentsPayload === "string") {
		return argumentsPayload
	}

	try {
		return JSON.stringify(argumentsPayload ?? {})
	} catch {
		return "{}"
	}
}

export class SubagentRunner {
	private activeApiAbort: (() => void) | undefined
	private abortRequested = false
	private activeCommandExecutions = 0
	private abortingCommands = false

	constructor(private baseConfig: TaskConfig) {}

	async abort(): Promise<void> {
		this.abortRequested = true

		try {
			this.activeApiAbort?.()
		} catch (error) {
			Logger.error("[SubagentRunner] failed to abort active API stream", error)
		}

		if (this.activeCommandExecutions > 0 && !this.abortingCommands && this.baseConfig.callbacks.cancelRunningCommandTool) {
			this.abortingCommands = true
			try {
				await this.baseConfig.callbacks.cancelRunningCommandTool()
			} catch (error) {
				Logger.error("[SubagentRunner] failed to cancel running command execution", error)
			} finally {
				this.abortingCommands = false
			}
		}
	}

	private shouldAbort(): boolean {
		return this.abortRequested || this.baseConfig.taskState.abort
	}

	async run(prompt: string, onProgress: (update: SubagentProgressUpdate) => void): Promise<SubagentRunResult> {
		this.abortRequested = false
		const state = new TaskState()
		const stats: SubagentRunStats = {
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		}

		onProgress({ status: "running", stats })

		try {
			const mode = this.baseConfig.services.stateManager.getGlobalSettingsKey("mode")
			const apiConfiguration = this.baseConfig.services.stateManager.getApiConfiguration()
			const api = buildApiHandler(apiConfiguration, mode)
			this.activeApiAbort = api.abort?.bind(api)

			const providerId = (
				mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
			) as string
			const providerInfo = {
				providerId,
				model: api.getModel(),
				mode,
				customPrompt: this.baseConfig.services.stateManager.getGlobalSettingsKey("customPrompt"),
			}

			const host = await HostProvider.env.getHostVersion({})
			const discoveredSkills = await discoverSkills(this.baseConfig.cwd)
			const skills = getAvailableSkills(discoveredSkills)

			const context: SystemPromptContext = {
				providerInfo,
				cwd: this.baseConfig.cwd,
				ide: host?.platform || "Unknown",
				skills,
				focusChainSettings: this.baseConfig.focusChainSettings,
				browserSettings: this.baseConfig.browserSettings,
				yoloModeToggled: false,
				enableNativeToolCalls: true,
				enableParallelToolCalling: false,
				isSubagentRun: true,
			}

			const promptRegistry = PromptRegistry.getInstance()
			const systemPrompt = (await promptRegistry.get(context)) + SUBAGENT_SYSTEM_SUFFIX
			const nativeTools = this.buildNativeTools(context)

			if (!nativeTools || nativeTools.length === 0) {
				const error = "Subagent tool requires native tool calling support."
				onProgress({ status: "failed", error, stats })
				return { status: "failed", error, stats }
			}

			if (this.shouldAbort()) {
				await this.abort()
				const error = "Subagent run cancelled."
				onProgress({ status: "failed", error, stats: { ...stats } })
				return { status: "failed", error, stats }
			}

			const conversation: ClineStorageMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: prompt,
						} as ClineTextContentBlock,
					],
				},
			]

			while (true) {
				const streamHandler = new StreamResponseHandler()
				const { toolUseHandler } = streamHandler.getHandlers()

				let assistantText = ""
				let assistantTextSignature: string | undefined
				let requestId: string | undefined

				const stream = api.createMessage(systemPrompt, conversation, nativeTools)

				for await (const chunk of stream) {
					switch (chunk.type) {
						case "usage":
							requestId = requestId ?? chunk.id
							stats.inputTokens += chunk.inputTokens || 0
							stats.outputTokens += chunk.outputTokens || 0
							stats.cacheWriteTokens += chunk.cacheWriteTokens || 0
							stats.cacheReadTokens += chunk.cacheReadTokens || 0
							onProgress({ stats: { ...stats } })
							break
						case "text":
							requestId = requestId ?? chunk.id
							assistantText += chunk.text || ""
							assistantTextSignature = chunk.signature || assistantTextSignature
							break
						case "tool_calls":
							requestId = requestId ?? chunk.id
							toolUseHandler.processToolUseDelta(
								{
									id: chunk.tool_call.function?.id,
									type: "tool_use",
									name: chunk.tool_call.function?.name,
									input: normalizeToolCallArguments(chunk.tool_call.function?.arguments),
									signature: chunk.signature,
								},
								chunk.tool_call.call_id,
							)
							break
						case "reasoning":
							requestId = requestId ?? chunk.id
							break
					}

					if (this.shouldAbort()) {
						await this.abort()
						const error = "Subagent run cancelled."
						onProgress({ status: "failed", error, stats: { ...stats } })
						return { status: "failed", error, stats }
					}
				}

				const finalizedToolCalls = toolUseHandler.getAllFinalizedToolUses()
				const assistantContent = [] as any[]
				if (assistantText.trim().length > 0) {
					assistantContent.push({
						type: "text",
						text: assistantText,
						signature: assistantTextSignature,
					})
				}
				assistantContent.push(...finalizedToolCalls)

				if (assistantContent.length > 0) {
					conversation.push({
						role: "assistant",
						content: assistantContent,
						id: requestId,
					})
				}

				if (finalizedToolCalls.length === 0) {
					if (assistantText.trim().length > 0) {
						onProgress({ status: "completed", result: assistantText.trim(), stats: { ...stats } })
						return { status: "completed", result: assistantText.trim(), stats }
					}

					const error = "Subagent ended without a final text response."
					onProgress({ status: "failed", error, stats: { ...stats } })
					return { status: "failed", error, stats }
				}

				const toolResultBlocks = [] as any[]
				for (const call of finalizedToolCalls) {
					const toolName = call.name as ClineDefaultTool

					if (!SUBAGENT_ALLOWED_TOOLS.includes(toolName)) {
						const deniedResult = formatResponse.toolError(`Tool '${toolName}' is not available inside subagent runs.`)
						toolResultBlocks.push({
							type: "tool_result",
							tool_use_id: call.id || call.call_id,
							call_id: call.call_id,
							content: deniedResult,
						})
						continue
					}

					const toolCallParams = toToolUseParams(call.input)

					const toolCallBlock: ToolUse = {
						type: "tool_use",
						name: toolName,
						params: toolCallParams,
						partial: false,
						isNativeToolCall: true,
						call_id: call.call_id,
						signature: call.signature,
					}

					if (call.call_id && call.id) {
						state.toolUseIdMap.set(call.call_id, call.id)
					}

					const subagentConfig = this.createSubagentTaskConfig(state)
					const handler = this.baseConfig.coordinator.getHandler(toolName)
					let toolResult: unknown

					if (!handler) {
						toolResult = formatResponse.toolError(`No handler registered for tool '${toolName}'.`)
					} else {
						try {
							toolResult = await handler.execute(subagentConfig, toolCallBlock)
						} catch (error) {
							toolResult = formatResponse.toolError((error as Error).message)
						}
					}

					stats.toolCalls += 1
					onProgress({ stats: { ...stats } })

					toolResultBlocks.push({
						type: "tool_result",
						tool_use_id: call.id || call.call_id,
						call_id: call.call_id,
						content: serializeToolResult(toolResult),
					})
				}

				conversation.push({
					role: "user",
					content: toolResultBlocks,
				})

				await delay(0)
			}
		} catch (error) {
			if (this.shouldAbort()) {
				const cancelledError = "Subagent run cancelled."
				onProgress({ status: "failed", error: cancelledError, stats: { ...stats } })
				return { status: "failed", error: cancelledError, stats }
			}

			const errorText = (error as Error).message || "Subagent execution failed."
			Logger.error("[SubagentRunner] run failed", error)
			onProgress({ status: "failed", error: errorText, stats: { ...stats } })
			return { status: "failed", error: errorText, stats }
		} finally {
			this.activeApiAbort = undefined
		}
	}

	private createSubagentTaskConfig(state: TaskState): TaskConfig {
		const baseCallbacks = this.baseConfig.callbacks

		return {
			...this.baseConfig,
			taskState: state,
			isSubagentExecution: true,
			callbacks: {
				...baseCallbacks,
				executeCommandTool: async (command: string, timeoutSeconds: number | undefined) => {
					this.activeCommandExecutions += 1
					try {
						return await baseCallbacks.executeCommandTool(command, timeoutSeconds)
					} finally {
						this.activeCommandExecutions = Math.max(0, this.activeCommandExecutions - 1)
					}
				},
			},
		}
	}

	private buildNativeTools(context: SystemPromptContext) {
		const family = PromptRegistry.getInstance().getModelFamily(context)
		const toolSets = ClineToolSet.getToolsForVariantWithFallback(family, SUBAGENT_ALLOWED_TOOLS)
		const filteredToolSpecs = toolSets
			.map((toolSet) => toolSet.config)
			.filter((toolSpec) => !toolSpec.contextRequirements || toolSpec.contextRequirements(context))

		const converter = ClineToolSet.getNativeConverter(context.providerInfo.providerId, context.providerInfo.model.id)

		return filteredToolSpecs.map((tool) => converter(tool, context))
	}
}
