import { setTimeout as delay } from "node:timers/promises"
import type { ApiHandler } from "@core/api"
import { parseAssistantMessageV2, ToolUse } from "@core/assistant-message"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { checkContextWindowExceededError } from "@core/context/context-management/context-error-handling"
import { discoverSkills, getAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import { formatResponse } from "@core/prompts/responses"
import { PromptRegistry } from "@core/prompts/system-prompt"
import { ClineToolSet } from "@core/prompts/system-prompt/registry/ClineToolSet"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { StreamResponseHandler } from "@core/task/StreamResponseHandler"
import { ClineAssistantToolUseBlock, ClineStorageMessage, ClineTextContentBlock } from "@shared/messages"
import { Logger } from "@shared/services/Logger"
import type { ClineTool } from "@shared/tools"
import { ClineDefaultTool } from "@shared/tools"
import * as path from "path"
import { CoreAgent } from "@/core/agents/CoreAgent"
import { HostProvider } from "@/hosts/host-provider"
import { ApiFormat } from "@/shared/proto/cline/models"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { TaskState } from "../../TaskState"
import type { TaskConfig } from "../types/TaskConfig"

const SUBAGENT_ALLOWED_TOOLS: ClineDefaultTool[] = [
	ClineDefaultTool.FILE_READ,
	ClineDefaultTool.LIST_FILES,
	ClineDefaultTool.SEARCH,
	ClineDefaultTool.LIST_CODE_DEF,
	ClineDefaultTool.BASH,
	ClineDefaultTool.USE_SKILL,
	ClineDefaultTool.ATTEMPT,
]
const MAX_EMPTY_ASSISTANT_RETRIES = 3
const MAX_INITIAL_STREAM_ATTEMPTS = 3
const INITIAL_STREAM_RETRY_BASE_DELAY_MS = 250

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

const SUBAGENT_SYSTEM_SUFFIX = `\n\n# Subagent Execution Mode
You are running as a research subagent. Your job is to explore the codebase and gather information to answer the question.
Explore, read related files, trace through call chains, and build a complete picture before reporting back.
You can read files, list directories, search for patterns, list code definitions, and run commands.
Only use execute_command for readonly operations like ls, grep, git log, git diff, gh, etc.
When it makes sense, be clever about chaining commands or in-command scripting in execute_command to quickly get relevant context - and using pipes / filters to help narrow results.
Do not run commands that modify files or system state.
When you have a comprehensive answer, call the attempt_completion tool.
The attempt_completion result field is sent directly to the main agent, so put your full final findings there.
Unless the subagent prompt explicitly asks for detailed analysis, keep the result concise and focus on the files the main agent should read next.
Include a section titled "Relevant file paths" and list only file paths, one per line.
Do not include line numbers, summaries, or per-file explanations unless explicitly requested.
`

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
	private activeApiAbort: (() => void) | undefined
	private abortRequested = false
	private activeCommandExecutions = 0
	private abortingCommands = false
	private coreAgent = new CoreAgent()

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
		let previousRequestTotalTokens: number | undefined
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
			const effectiveApiConfiguration = {
				...apiConfiguration,
				ulid: this.baseConfig.ulid,
			}
			const api = this.coreAgent.initializeApiHandler(effectiveApiConfiguration, mode)
			this.activeApiAbort = () => this.coreAgent.abortCurrentRequest()

			const providerId = (
				mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
			) as string
			const providerInfo = {
				providerId,
				model: this.coreAgent.getModel(),
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
			const systemPrompt = (await promptRegistry.get(context)) + SUBAGENT_SYSTEM_SUFFIX
			const useNativeToolCalls = !!promptRegistry.nativeTools?.length
			const nativeTools = useNativeToolCalls ? this.buildNativeTools(context) : undefined
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

			const loopResult = await this.coreAgent.runLoop<void, SubagentRunResult>({
				initialInput: undefined,
				shouldAbort: () => this.shouldAbort(),
				runTurn: async () => {
					if (
						previousRequestTotalTokens !== undefined &&
						this.coreAgent.shouldCompactBeforeNextRequest(
							previousRequestTotalTokens,
							api,
							providerInfo.model.id,
							this.baseConfig.services.stateManager.getGlobalSettingsKey("useAutoCondense"),
						)
					) {
						const didCompact = this.compactConversationForContextWindow(conversation)
						if (didCompact) {
							Logger.warn("[SubagentRunner] Proactively compacted context before next subagent request.")
						}
						previousRequestTotalTokens = undefined
					}

					const streamHandler = new StreamResponseHandler()
					const { toolUseHandler } = streamHandler.getHandlers()

					const stream = this.createMessageWithInitialChunkRetry(
						api,
						systemPrompt,
						conversation,
						nativeTools,
						providerInfo.providerId,
						providerInfo.model.id,
					)

					const streamResult = await this.coreAgent.consumeStream({
						stream,
						shouldAbort: () => this.shouldAbort(),
						onAbort: async () => {
							await this.abort()
						},
						onUsageChunk: (chunk, state) => {
							stats.inputTokens += chunk.inputTokens || 0
							stats.outputTokens += chunk.outputTokens || 0
							stats.cacheWriteTokens += chunk.cacheWriteTokens || 0
							stats.cacheReadTokens += chunk.cacheReadTokens || 0
							stats.contextTokens =
								state.usage.inputTokens +
								state.usage.outputTokens +
								state.usage.cacheWriteTokens +
								state.usage.cacheReadTokens
							stats.contextUsagePercentage =
								stats.contextWindow > 0 ? (stats.contextTokens / stats.contextWindow) * 100 : 0
							onProgress({ stats: { ...stats } })
						},
						onToolCallChunk: (chunk) => {
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
						},
					})

					if (streamResult.aborted) {
						return { status: "failed", error: "Subagent run cancelled." }
					}

					const calculatedRequestCost =
						streamResult.usage.totalCost ??
						calculateApiCostAnthropic(
							providerInfo.model.info,
							streamResult.usage.inputTokens,
							streamResult.usage.outputTokens,
							streamResult.usage.cacheWriteTokens,
							streamResult.usage.cacheReadTokens,
						)
					stats.totalCost += calculatedRequestCost || 0
					previousRequestTotalTokens =
						streamResult.usage.inputTokens +
						streamResult.usage.outputTokens +
						streamResult.usage.cacheWriteTokens +
						streamResult.usage.cacheReadTokens

					const nativeFinalizedToolCalls = toolUseHandler.getAllFinalizedToolUses().map((toolCall, index) => ({
						toolUseId: resolveToolUseId(toolCall, index),
						id: toolCall.id,
						call_id: toolCall.call_id,
						signature: toolCall.signature,
						name: toolCall.name,
						input: toolCall.input,
						isNativeToolCall: true,
					}))
					const parsedNonNativeToolCalls = parseNonNativeToolCalls(streamResult.assistantText)
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
						Logger.warn(
							"[SubagentRunner] Received structured tool_calls while native tool calling is disabled; falling back to non-native result serialization.",
						)
						finalizedToolCalls = fallbackNonNativeToolCalls
					}
					const assistantContent = [] as any[]
					if (streamResult.assistantText.trim().length > 0) {
						assistantContent.push({
							type: "text",
							text: streamResult.assistantText,
							signature: streamResult.assistantTextSignature,
						})
					}
					if (useNativeToolCalls) {
						assistantContent.push(...finalizedToolCalls.map(toAssistantToolUseBlock))
					}

					if (assistantContent.length > 0) {
						conversation.push({
							role: "assistant",
							content: assistantContent,
							id: streamResult.requestId,
						})
					}

					if (finalizedToolCalls.length === 0) {
						emptyAssistantResponseRetries += 1
						if (emptyAssistantResponseRetries > MAX_EMPTY_ASSISTANT_RETRIES) {
							return { status: "failed", error: "Subagent did not call attempt_completion." }
						}

						if (assistantContent.length === 0) {
							conversation.push({
								role: "assistant",
								content: [{ type: "text", text: "Failure: I did not provide a response." }],
								id: streamResult.requestId,
							})
						}
						conversation.push({
							role: "user",
							content: [{ type: "text", text: formatResponse.noToolsUsed(useNativeToolCalls) }],
						})
						await delay(0)
						return { status: "continue", nextInput: undefined }
					}
					emptyAssistantResponseRetries = 0

					const toolResultBlocks = [] as any[]
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
							const completed: SubagentRunResult = { status: "completed", result: completionResult, stats }
							return { status: "complete", output: completed }
						}

						if (!SUBAGENT_ALLOWED_TOOLS.includes(toolName)) {
							const deniedResult = formatResponse.toolError(
								`Tool '${toolName}' is not available inside subagent runs.`,
							)
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

						onProgress({ latestToolCall: formatToolCallPreview(toolName, toolCallParams) })

						const subagentConfig = this.createSubagentTaskConfig(state)
						const handler = this.baseConfig.coordinator.getHandler(toolName)
						let toolResult: unknown

						if (!handler) {
							toolResult = formatResponse.toolError(`No handler registered for tool '${toolName}'.`)
						} else {
							try {
								toolResult = await this.baseConfig.coordinator.execute(subagentConfig, toolCallBlock)
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
					return { status: "continue", nextInput: undefined }
				},
			})

			if (loopResult.status === "complete") {
				onProgress({ status: "completed", result: loopResult.output.result, stats: { ...stats } })
				return loopResult.output
			}
			if (loopResult.status === "failed") {
				const error = loopResult.error || "Subagent execution failed."
				onProgress({ status: "failed", error, stats: { ...stats } })
				return { status: "failed", error, stats }
			}
			const cancelledError = "Subagent run cancelled."
			onProgress({ status: "failed", error: cancelledError, stats: { ...stats } })
			return { status: "failed", error: cancelledError, stats }
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

	private compactConversationForContextWindow(conversation: ClineStorageMessage[]): boolean {
		const contextManager = new ContextManager()
		const optimizationResult = this.optimizeConversationForContextWindow(contextManager, conversation)
		if (optimizationResult.didOptimize && !optimizationResult.needToTruncate) {
			return true
		}

		const deletedRange = contextManager.getNextTruncationRange(conversation, undefined, "quarter")
		if (deletedRange[1] < deletedRange[0]) {
			return optimizationResult.didOptimize
		}

		const truncated = contextManager
			.getTruncatedMessages(conversation, deletedRange)
			.map((message) => message as ClineStorageMessage)
		if (truncated.length >= conversation.length) {
			return optimizationResult.didOptimize
		}

		conversation.splice(0, conversation.length, ...truncated)
		return true
	}

	private optimizeConversationForContextWindow(
		contextManager: ContextManager,
		conversation: ClineStorageMessage[],
	): {
		didOptimize: boolean
		needToTruncate: boolean
	} {
		const timestamp = Date.now()
		const optimizationResult = contextManager.attemptFileReadOptimizationInMemory(conversation, undefined, timestamp)
		if (!optimizationResult.anyContextUpdates) {
			return { didOptimize: false, needToTruncate: true }
		}

		const optimizedConversation = optimizationResult.optimizedConversationHistory.map(
			(message) => message as ClineStorageMessage,
		)
		conversation.splice(0, conversation.length, ...optimizedConversation)
		return { didOptimize: true, needToTruncate: optimizationResult.needToTruncate }
	}

	private async *createMessageWithInitialChunkRetry(
		api: ApiHandler,
		systemPrompt: string,
		conversation: ClineStorageMessage[],
		nativeTools: ClineTool[] | undefined,
		providerId: string,
		modelId: string,
	) {
		for (let attempt = 1; attempt <= MAX_INITIAL_STREAM_ATTEMPTS; attempt += 1) {
			const stream = this.coreAgent.createMessage(systemPrompt, conversation, nativeTools)
			const iterator = stream[Symbol.asyncIterator]()

			try {
				const firstChunk = await iterator.next()
				if (!firstChunk.done) {
					yield firstChunk.value
				}

				yield* iterator
				return
			} catch (error) {
				if (checkContextWindowExceededError(error)) {
					const didCompact = this.compactConversationForContextWindow(conversation)
					if (!didCompact || this.shouldAbort() || attempt >= MAX_INITIAL_STREAM_ATTEMPTS) {
						throw error
					}
					Logger.warn(
						`[SubagentRunner] Context window exceeded on initial stream attempt ${attempt}; compacted conversation and retrying.`,
					)
					continue
				}

				const shouldRetry =
					!this.shouldAbort() &&
					attempt < MAX_INITIAL_STREAM_ATTEMPTS &&
					this.coreAgent.classifyInitialStreamRetry(error, providerId, modelId).shouldRetry
				if (!shouldRetry) {
					throw error
				}

				const delayMs = INITIAL_STREAM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
				Logger.warn(`[SubagentRunner] Initial stream failed. Retrying attempt ${attempt + 1}.`, error)
				await delay(delayMs)
			}
		}
	}

	private buildNativeTools(context: SystemPromptContext): ClineTool[] {
		const family = PromptRegistry.getInstance().getModelFamily(context)
		const toolSets = ClineToolSet.getToolsForVariantWithFallback(family, SUBAGENT_ALLOWED_TOOLS)
		const filteredToolSpecs = toolSets
			.map((toolSet) => toolSet.config)
			.filter((toolSpec) => !toolSpec.contextRequirements || toolSpec.contextRequirements(context))

		const converter = ClineToolSet.getNativeConverter(context.providerInfo.providerId, context.providerInfo.model.id)

		return filteredToolSpecs.map((tool) => converter(tool, context))
	}
}
