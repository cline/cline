import * as path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { ApiHandler } from "@core/api"
import { parseAssistantMessageV2, ToolUse } from "@core/assistant-message"
import { discoverSkills, getAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import { formatResponse } from "@core/prompts/responses"
import { PromptRegistry } from "@core/prompts/system-prompt"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { StreamResponseHandler } from "@core/task/StreamResponseHandler"
import { ClineAssistantToolUseBlock, ClineStorageMessage, ClineTextContentBlock, ClineUserContent } from "@shared/messages"
import { Logger } from "@shared/services/Logger"
import { ClineDefaultTool } from "@shared/tools"
import { HostProvider } from "@/hosts/host-provider"
import { ApiFormat } from "@/shared/proto/cline/models"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { TaskState } from "../../TaskState"
import { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import { SubagentBuilder } from "./SubagentBuilder"

const MAX_EMPTY_ASSISTANT_RETRIES = 3

export type SubagentRunStatus = "completed" | "failed"

export interface SubagentRunResult {
	status: SubagentRunStatus
	result?: string
	error?: string
	stats: SubagentRunStats
}

interface SubagentProgressUpdate {
	stats?: SubagentRunStats
	latestToolCall?: string
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
	totalCost: number
	contextTokens: number
	contextWindow: number
	contextUsagePercentage: number
}

interface SubagentToolCall {
	toolUseId: string
	id?: string
	call_id?: string
	signature?: string
	name: string
	input: unknown
	isNativeToolCall: boolean
}

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

function formatToolArgPreview(value: string, maxLength = 48): string {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= maxLength) {
		return normalized
	}
	return `${normalized.slice(0, maxLength - 3)}...`
}

function formatToolCallPreview(toolName: string, params: Partial<Record<string, string>>): string {
	const entries = Object.entries(params).filter(([, value]) => value !== undefined)
	const visibleEntries = entries.slice(0, 3)
	const omittedCount = Math.max(0, entries.length - visibleEntries.length)

	const args = visibleEntries
		.map(([key, value]) => `${key}=${formatToolArgPreview(value ?? "")}`)
		.concat(omittedCount > 0 ? [`...+${omittedCount}`] : [])
		.join(", ")

	return `${toolName}(${args})`
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

function resolveToolUseId(call: { id?: string; call_id?: string; name?: string }, index: number): string {
	const id = call.id?.trim()
	if (id) {
		return id
	}

	const callId = call.call_id?.trim()
	if (callId) {
		return callId
	}

	const fallbackId = `subagent_tool_${Date.now()}_${index + 1}`
	Logger.warn(`[SubagentRunner] Missing tool call id for '${call.name || "unknown"}'; using fallback '${fallbackId}'`)
	return fallbackId
}

function toAssistantToolUseBlock(call: SubagentToolCall): ClineAssistantToolUseBlock {
	return {
		type: "tool_use",
		id: call.toolUseId,
		name: call.name,
		input: call.input,
		call_id: call.call_id,
		signature: call.signature,
	}
}

function parseNonNativeToolCalls(assistantText: string): SubagentToolCall[] {
	const parsedBlocks = parseAssistantMessageV2(assistantText)

	return parsedBlocks
		.filter((block): block is ToolUse => block.type === "tool_use")
		.filter((block) => !block.partial)
		.map((block, index) => ({
			toolUseId: resolveToolUseId({ call_id: block.call_id, name: block.name }, index),
			name: block.name,
			input: block.params,
			call_id: block.call_id,
			signature: block.signature,
			isNativeToolCall: false,
		}))
}

function pushSubagentToolResultBlock(toolResultBlocks: any[], call: SubagentToolCall, label: string, content: string): void {
	if (call.isNativeToolCall) {
		toolResultBlocks.push({
			type: "tool_result",
			tool_use_id: call.toolUseId,
			call_id: call.call_id,
			content,
		})
		return
	}

	toolResultBlocks.push({
		type: "text",
		text: `${label} Result:\n${content}`,
	})
}

export class SubagentRunner {
	private readonly agent: SubagentBuilder
	private readonly apiHandler: ApiHandler
	private readonly allowedTools: ClineDefaultTool[]
	private activeApiAbort: (() => void) | undefined
	private abortRequested = false
	private activeCommandExecutions = 0
	private abortingCommands = false

	constructor(
		private baseConfig: TaskConfig,
		subagentName = "subagent",
	) {
		this.agent = new SubagentBuilder(baseConfig, subagentName)
		this.apiHandler = this.agent.getApiHandler()
		this.allowedTools = this.agent.getAllowedTools()
	}

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

	private async getWorkspaceMetadataEnvironmentBlock(): Promise<string | null> {
		try {
			const workspacesJson =
				(await this.baseConfig.workspaceManager?.buildWorkspacesJson()) ??
				JSON.stringify(
					{
						workspaces: {
							[this.baseConfig.cwd]: {
								hint: path.basename(this.baseConfig.cwd) || this.baseConfig.cwd,
							},
						},
					},
					null,
					2,
				)

			return `<environment_details>\n# Workspace Configuration\n${workspacesJson}\n</environment_details>`
		} catch (error) {
			Logger.warn("[SubagentRunner] Failed to build workspace metadata block", error)
			return null
		}
	}

	async run(prompt: string, onProgress: (update: SubagentProgressUpdate) => void): Promise<SubagentRunResult> {
		this.abortRequested = false
		const state = new TaskState()
		let emptyAssistantResponseRetries = 0
		const stats: SubagentRunStats = {
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
		}

		onProgress({ status: "running", stats })

		try {
			const mode = this.baseConfig.services.stateManager.getGlobalSettingsKey("mode")
			const apiConfiguration = this.baseConfig.services.stateManager.getApiConfiguration()
			const api = this.apiHandler
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
			stats.contextWindow = providerInfo.model.info.contextWindow || 0
			const nativeToolCallsRequested =
				providerInfo.model.info.apiFormat === ApiFormat.OPENAI_RESPONSES ||
				!!this.baseConfig.services.stateManager.getGlobalStateKey("nativeToolCallEnabled")

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
				enableNativeToolCalls: nativeToolCallsRequested,
				enableParallelToolCalling: false,
				isSubagentRun: true,
			}

			const promptRegistry = PromptRegistry.getInstance()
			const generatedSystemPrompt = await promptRegistry.get(context)
			const systemPrompt = this.agent.buildSystemPrompt(generatedSystemPrompt)
			const useNativeToolCalls = !!promptRegistry.nativeTools?.length
			const nativeTools = useNativeToolCalls ? this.agent.buildNativeTools(context) : undefined
			const workspaceMetadataEnvironmentBlock = await this.getWorkspaceMetadataEnvironmentBlock()

			if (useNativeToolCalls && (!nativeTools || nativeTools.length === 0)) {
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
						// Server-side task loop checks require workspace metadata to be present in the
						// initial user message of subagent runs.
						...(workspaceMetadataEnvironmentBlock
							? [
									{
										type: "text",
										text: workspaceMetadataEnvironmentBlock,
									} as ClineTextContentBlock,
								]
							: []),
					],
				},
			]

			while (true) {
				const streamHandler = new StreamResponseHandler()
				const { toolUseHandler } = streamHandler.getHandlers()
				let requestInputTokens = 0
				let requestOutputTokens = 0
				let requestCacheWriteTokens = 0
				let requestCacheReadTokens = 0
				let requestTotalCost: number | undefined

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
							requestInputTokens += chunk.inputTokens || 0
							requestOutputTokens += chunk.outputTokens || 0
							requestCacheWriteTokens += chunk.cacheWriteTokens || 0
							requestCacheReadTokens += chunk.cacheReadTokens || 0
							requestTotalCost = chunk.totalCost ?? requestTotalCost
							stats.contextTokens =
								requestInputTokens + requestOutputTokens + requestCacheWriteTokens + requestCacheReadTokens
							stats.contextUsagePercentage =
								stats.contextWindow > 0 ? (stats.contextTokens / stats.contextWindow) * 100 : 0
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

				const calculatedRequestCost =
					requestTotalCost ??
					calculateApiCostAnthropic(
						providerInfo.model.info,
						requestInputTokens,
						requestOutputTokens,
						requestCacheWriteTokens,
						requestCacheReadTokens,
					)
				stats.totalCost += calculatedRequestCost || 0

				const nativeFinalizedToolCalls = toolUseHandler.getAllFinalizedToolUses().map((toolCall, index) => ({
					toolUseId: resolveToolUseId(toolCall, index),
					id: toolCall.id,
					call_id: toolCall.call_id,
					signature: toolCall.signature,
					name: toolCall.name,
					input: toolCall.input,
					isNativeToolCall: true,
				}))
				const parsedNonNativeToolCalls = parseNonNativeToolCalls(assistantText)
				const fallbackNonNativeToolCalls = nativeFinalizedToolCalls.map((toolCall) => ({
					...toolCall,
					isNativeToolCall: false,
				}))

				let finalizedToolCalls: SubagentToolCall[] = []
				if (useNativeToolCalls) {
					finalizedToolCalls = nativeFinalizedToolCalls
				} else if (parsedNonNativeToolCalls.length > 0) {
					finalizedToolCalls = parsedNonNativeToolCalls
				} else if (fallbackNonNativeToolCalls.length > 0) {
					// Defensive fallback: if non-native mode receives structured tool call chunks,
					// execute them but serialize results as plain text to avoid tool_result pairing mismatches.
					Logger.warn(
						"[SubagentRunner] Received structured tool_calls while native tool calling is disabled; falling back to non-native result serialization.",
					)
					finalizedToolCalls = fallbackNonNativeToolCalls
				}
				const assistantContent = [] as any[]
				if (assistantText.trim().length > 0) {
					assistantContent.push({
						type: "text",
						text: assistantText,
						signature: assistantTextSignature,
					})
				}
				if (useNativeToolCalls) {
					assistantContent.push(...finalizedToolCalls.map(toAssistantToolUseBlock))
				}

				if (assistantContent.length > 0) {
					conversation.push({
						role: "assistant",
						content: assistantContent,
						id: requestId,
					})
				}

				if (finalizedToolCalls.length === 0) {
					emptyAssistantResponseRetries += 1
					if (emptyAssistantResponseRetries > MAX_EMPTY_ASSISTANT_RETRIES) {
						const error = "Subagent did not call attempt_completion."
						onProgress({ status: "failed", error, stats: { ...stats } })
						return { status: "failed", error, stats }
					}

					// Mirror the main loop's no-tools-used nudge so empty/blank model turns
					// can recover without surfacing an immediate hard failure in subagent UI.
					if (assistantContent.length === 0) {
						conversation.push({
							role: "assistant",
							content: [
								{
									type: "text",
									text: "Failure: I did not provide a response.",
								},
							],
							id: requestId,
						})
					}
					conversation.push({
						role: "user",
						content: [
							{
								type: "text",
								text: formatResponse.noToolsUsed(useNativeToolCalls),
							},
						],
					})
					await delay(0)
					continue
				}
				emptyAssistantResponseRetries = 0

				const toolResultBlocks = [] as ClineUserContent[]
				for (const call of finalizedToolCalls) {
					const toolName = call.name as ClineDefaultTool
					const toolCallParams = toToolUseParams(call.input)

					if (toolName === ClineDefaultTool.ATTEMPT) {
						const completionResult = toolCallParams.result?.trim()
						if (!completionResult) {
							const missingResultError = formatResponse.missingToolParameterError("result")
							pushSubagentToolResultBlock(toolResultBlocks, call, toolName, missingResultError)
							continue
						}

						stats.toolCalls += 1
						onProgress({ stats: { ...stats } })
						onProgress({ status: "completed", result: completionResult, stats: { ...stats } })
						return { status: "completed", result: completionResult, stats }
					}

					if (!this.allowedTools.includes(toolName)) {
						const deniedResult = formatResponse.toolError(`Tool '${toolName}' is not available inside subagent runs.`)
						pushSubagentToolResultBlock(toolResultBlocks, call, toolName, deniedResult)
						continue
					}

					const toolCallBlock: ToolUse = {
						type: "tool_use",
						name: toolName,
						params: toolCallParams,
						partial: false,
						isNativeToolCall: call.isNativeToolCall,
						call_id: call.call_id || call.toolUseId,
						signature: call.signature,
					}

					if (call.call_id) {
						state.toolUseIdMap.set(call.call_id, call.toolUseId)
					}

					const latestToolCall = formatToolCallPreview(toolName, toolCallParams)
					onProgress({ latestToolCall })

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

					const serializedToolResult = serializeToolResult(toolResult)
					const toolDescription = handler?.getDescription(toolCallBlock) || `[${toolName}]`
					pushSubagentToolResultBlock(toolResultBlocks, call, toolDescription, serializedToolResult)
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
		const coordinator = new ToolExecutorCoordinator()
		const validator = new ToolValidator(this.baseConfig.services.clineIgnoreController)

		for (const tool of this.allowedTools) {
			coordinator.registerByName(tool, validator)
		}

		return {
			...this.baseConfig,
			api: this.apiHandler,
			coordinator,
			taskState: state,
			isSubagentExecution: true,
			vscodeTerminalExecutionMode: "backgroundExec",
			callbacks: {
				...baseCallbacks,
				say: async () => undefined,
				sayAndCreateMissingParamError: async (_toolName, paramName) =>
					formatResponse.toolError(formatResponse.missingToolParameterError(paramName)),
				executeCommandTool: async (command: string, timeoutSeconds: number | undefined) => {
					this.activeCommandExecutions += 1
					try {
						return await baseCallbacks.executeCommandTool(command, timeoutSeconds, {
							useBackgroundExecution: true,
							suppressUserInteraction: true,
						})
					} finally {
						this.activeCommandExecutions = Math.max(0, this.activeCommandExecutions - 1)
					}
				},
			},
		}
	}
}
