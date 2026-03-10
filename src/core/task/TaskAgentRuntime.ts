import { Agent, type AgentEvent, type AgentHooks, getClineDefaultSystemPrompt, type Tool } from "@cline/agents"
import { createBuiltinTools } from "@cline/core"
import { providers } from "@cline/llms"
import type { Hooks as HookInputs } from "@core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { formatContentBlockToMarkdown } from "@integrations/misc/export-markdown"
import { telemetryService } from "@services/telemetry"
import type { ApiConfiguration } from "@shared/api"
import type { ClineSay } from "@shared/ExtensionMessage"
import { buildClineExtraHeaders } from "@/services/EnvUtils"
import { type ClineContent, ClineMessageModelInfo } from "@/shared/messages"
import { Logger } from "@/shared/services/Logger"
import type { ApiProviderInfo } from "../api"
import { ensureVsCodeLmProviderRegistered, VSCODE_LM_SELECTOR_HEADER } from "../api/providers/registry"
import type { MessageStateHandler } from "./message-state"
import type { CreateTaskAgentHooksOptions } from "./TaskHookExtensionAdapter"
import type { HookExecution } from "./types/HookExecution"

type ProviderConnectionConfig = {
	apiKey?: string
	baseUrl?: string
	headers?: Record<string, string>
	knownModels?: Record<string, providers.ModelInfo>
}

type RegisteredModelInfo = providers.ModelInfo

function toRegisteredModelInfo(modelId: string, modelInfo: ApiProviderInfo["model"]["info"]): RegisteredModelInfo {
	const capabilities: RegisteredModelInfo["capabilities"] = []
	if (modelInfo.supportsImages) {
		capabilities.push("images")
	}
	if (modelInfo.supportsPromptCache) {
		capabilities.push("prompt-cache")
	}
	if (modelInfo.supportsReasoning) {
		capabilities.push("reasoning")
	}
	if (modelInfo.supportsGlobalEndpoint) {
		capabilities.push("global-endpoint")
	}

	return {
		id: modelId,
		name: modelInfo.name,
		description: modelInfo.description,
		maxTokens: modelInfo.maxTokens,
		contextWindow: modelInfo.contextWindow,
		temperature: modelInfo.temperature,
		capabilities: capabilities.length > 0 ? capabilities : undefined,
		pricing:
			modelInfo.inputPrice !== undefined ||
			modelInfo.outputPrice !== undefined ||
			modelInfo.cacheWritesPrice !== undefined ||
			modelInfo.cacheReadsPrice !== undefined
				? {
						input: modelInfo.inputPrice,
						output: modelInfo.outputPrice,
						cacheWrite: modelInfo.cacheWritesPrice,
						cacheRead: modelInfo.cacheReadsPrice,
					}
				: undefined,
		thinkingConfig: modelInfo.thinkingConfig
			? {
					maxBudget: modelInfo.thinkingConfig.maxBudget,
					outputPrice: modelInfo.thinkingConfig.outputPrice,
					thinkingLevel: modelInfo.thinkingConfig.geminiThinkingLevel,
				}
			: undefined,
	}
}

type AgentRuntimeHost = {
	taskId: string
	ulid: string
	cwd: string
	taskState: {
		apiRequestCount: number
		apiRequestsSinceLastTodoUpdate: number
		abort: boolean
	}
	say: (type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>
	postStateToWebview: () => Promise<void>
	getCurrentProviderInfo: () => ApiProviderInfo
	getApiConfiguration: () => ApiConfiguration
	loadContext: (
		userContent: ClineContent[],
		includeFileDetails: boolean,
		useCompactPrompt: boolean,
	) => Promise<[ClineContent[], string, boolean]>
	messageStateHandler: MessageStateHandler
	setActiveHookExecution: (hookExecution: HookExecution) => Promise<void>
	clearActiveHookExecution: () => Promise<void>
	runTaskLifecycleHook: <K extends "TaskStart" | "TaskResume">(params: {
		hookName: K
		hookInput: HookInputs[K]
	}) => Promise<{ cancel?: boolean; contextModification?: string; errorMessage?: string; wasCancelled: boolean }>
	runUserPromptSubmitHook: (
		userContent: ClineContent[],
	) => Promise<{ cancel?: boolean; contextModification?: string; errorMessage?: string; wasCancelled: boolean }>
	handleHookCancellation: (hookName: string, wasCancelled: boolean) => Promise<void>
	createAgentHooks: (options: CreateTaskAgentHooksOptions) => AgentHooks
	cancelTask: () => Promise<void>
}

export type TaskAgentRunContext = {
	phase: "initial_task" | "resume" | "continue"
	initialTask?: string
	resumePreviousState?: {
		lastMessageTs: string
		messageCount: string
		conversationHistoryDeleted: string
	}
	userPromptHookContent?: ClineContent[]
}

export class TaskAgentRuntime {
	private agent: InstanceType<typeof Agent> | undefined
	private agentSignature: string | undefined
	private readonly builtInTools: Tool[]
	private readonly host: AgentRuntimeHost
	private pendingRunContext: TaskAgentRunContext | undefined
	private streamedReasoning = ""

	constructor(host: AgentRuntimeHost) {
		this.host = host
		this.builtInTools = createBuiltinTools({ cwd: host.cwd })
	}

	async run(userContent: ClineContent[], runContext: TaskAgentRunContext): Promise<void> {
		this.host.taskState.apiRequestCount++
		this.host.taskState.apiRequestsSinceLastTodoUpdate++
		this.streamedReasoning = ""

		// const [parsedUserContent, environmentDetails] = await this.host.loadContext(userContent, includeFileDetails, false)
		// const normalizedUserContent = [...parsedUserContent]
		// if (environmentDetails) {
		// 	normalizedUserContent.push({ type: "text", text: environmentDetails })
		// }
		const normalizedUserContent = [...userContent]

		const userMessage = normalizedUserContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n")
		await this.host.say("api_req_started", JSON.stringify({ request: userMessage }))

		const providerInfo = this.host.getCurrentProviderInfo()
		const modelInfo: ClineMessageModelInfo = {
			modelId: providerInfo.model.id,
			providerId: providerInfo.providerId,
			mode: providerInfo.mode,
		}

		await this.host.messageStateHandler.addToApiConversationHistory({
			role: "user",
			content: normalizedUserContent,
			ts: Date.now(),
		})

		const customHeader = await buildClineExtraHeaders()

		this.pendingRunContext = runContext
		const { agent, reusedExistingAgent } = this.getOrCreateAgent(providerInfo, customHeader)
		const result = await (async () => {
			try {
				return reusedExistingAgent ? await agent.continue(userMessage) : await agent.run(userMessage)
			} finally {
				this.pendingRunContext = undefined
			}
		})()
		this.agent = agent

		if (result.text) {
			await this.host.say("text", result.text, undefined, undefined, false)
		}

		await this.host.messageStateHandler.addToApiConversationHistory({
			role: "assistant",
			content: [{ type: "text", text: result.text || "" }],
			modelInfo,
			metrics: {
				tokens: {
					prompt: result.usage.inputTokens || 0,
					completion: result.usage.outputTokens || 0,
					cached: (result.usage.cacheWriteTokens || 0) + (result.usage.cacheReadTokens || 0),
				},
				cost: result.usage.totalCost,
			},
			ts: Date.now(),
		})

		telemetryService.captureConversationTurnEvent(
			this.host.ulid,
			modelInfo.providerId,
			modelInfo.modelId,
			"assistant",
			modelInfo.mode,
			{
				tokensIn: result.usage.inputTokens || 0,
				tokensOut: result.usage.outputTokens || 0,
				cacheWriteTokens: result.usage.cacheWriteTokens || 0,
				cacheReadTokens: result.usage.cacheReadTokens || 0,
				totalCost: result.usage.totalCost,
			},
		)

		await this.host.postStateToWebview()
	}

	public abort(): void {
		this.agent?.abort()
	}

	private getOrCreateAgent(
		providerInfo: ReturnType<AgentRuntimeHost["getCurrentProviderInfo"]>,
		customHeader: Record<string, string>,
	): {
		agent: InstanceType<typeof Agent>
		reusedExistingAgent: boolean
	} {
		const apiConfig = this.host.getApiConfiguration()
		if (providerInfo.providerId === "vscode-lm") {
			ensureVsCodeLmProviderRegistered()
		}
		const providerConfig = this.resolveProviderConfig(providerInfo, apiConfig)
		const nextSignature = JSON.stringify({
			providerId: providerInfo.providerId,
			modelId: providerInfo.model.id,
			apiKey: providerConfig.apiKey ?? "",
			baseUrl: providerConfig.baseUrl ?? "",
			headers: providerConfig.headers ?? {},
			knownModels: providerConfig.knownModels ?? {},
		})

		if (this.agent && this.agentSignature === nextSignature) {
			return { agent: this.agent, reusedExistingAgent: true }
		}

		const defaultHeaders: Record<string, string> = {
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"X-Task-ID": this.host.ulid || "",
		}
		Object.assign(defaultHeaders, customHeader)

		const hooks = this.createAgentHooks()
		const agent = new Agent({
			providerId: providerInfo.providerId,
			modelId: providerInfo.model.id,
			apiKey: providerConfig.apiKey,
			baseUrl: providerConfig.baseUrl,
			headers: providerConfig.headers,
			knownModels: providerConfig.knownModels,
			systemPrompt: getClineDefaultSystemPrompt("VS Code", this.host.cwd),
			tools: this.builtInTools,
			hooks,
			maxIterations: 50,
			onEvent: async (event: AgentEvent) => {
				switch (event.type) {
					case "content_start":
						if (event.contentType === "text") {
							const nextText = event.accumulated ?? event.text
							if (nextText !== undefined) {
								await this.host.say("text", nextText, undefined, undefined, true)
							}
						}
						if (event.contentType === "reasoning" && event.reasoning !== undefined) {
							this.streamedReasoning += event.reasoning
							await this.host.say("reasoning", this.streamedReasoning, undefined, undefined, true)
						}
						if (event.contentType === "tool" && event.toolName) {
							Logger.debug(`[Task ${this.host.taskId}] Agent tool call start: ${event.toolName}`)
						}
						break
					case "content_end":
						if (event.contentType === "reasoning") {
							const finalReasoning = event.reasoning ?? this.streamedReasoning
							if (finalReasoning) {
								await this.host.say("reasoning", finalReasoning, undefined, undefined, false)
							}
						}
						break
					case "error":
						Logger.error(`[Task ${this.host.taskId}] Agent runtime error`, event.error)
						break
				}
			},
		})
		this.agent = agent
		this.agentSignature = nextSignature
		return { agent, reusedExistingAgent: false }
	}

	private createAgentHooks(): AgentHooks {
		return this.host.createAgentHooks({
			onRunStart: () => this.handleRunStartHook(),
			buildPendingToolInfo: (toolName, toolInput) => this.buildPendingToolInfo(toolName, toolInput),
			toHookStringParameters: (input) => this.toHookStringParameters(input),
			createHookContextBlock: (hookName, contextModification) => this.createHookContextBlock(hookName, contextModification),
			safeJsonStringify: (value) => this.safeJsonStringify(value),
		})
	}

	private async handleRunStartHook(): Promise<{ cancel?: boolean; context?: string } | undefined> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) {
			return undefined
		}

		const runContext = this.pendingRunContext
		if (!runContext) {
			return undefined
		}

		const contextBlocks: string[] = []

		if (runContext.phase === "initial_task") {
			const taskStartResult = await this.host.runTaskLifecycleHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: this.host.taskId,
							ulid: this.host.ulid,
							initialTask: runContext.initialTask || "",
						},
					},
				},
			})

			if (taskStartResult.cancel) {
				await this.host.handleHookCancellation("TaskStart", taskStartResult.wasCancelled)
				await this.host.cancelTask()
				return { cancel: true }
			}

			const taskStartContext = this.createHookContextBlock("TaskStart", taskStartResult.contextModification)
			if (taskStartContext) {
				contextBlocks.push(taskStartContext)
			}
		}

		if (runContext.phase === "resume") {
			const taskResumeResult = await this.host.runTaskLifecycleHook({
				hookName: "TaskResume",
				hookInput: {
					taskResume: {
						taskMetadata: {
							taskId: this.host.taskId,
							ulid: this.host.ulid,
						},
						previousState: runContext.resumePreviousState || {
							lastMessageTs: "",
							messageCount: "0",
							conversationHistoryDeleted: "false",
						},
					},
				},
			})

			if (taskResumeResult.cancel) {
				await this.host.handleHookCancellation("TaskResume", taskResumeResult.wasCancelled)
				await this.host.cancelTask()
				return { cancel: true }
			}

			const taskResumeContext = this.createHookContextBlock("TaskResume", taskResumeResult.contextModification)
			if (taskResumeContext) {
				contextBlocks.push(taskResumeContext)
			}
		}

		const userPromptHookContent = runContext.userPromptHookContent ?? []
		const userPromptResult = await this.host.runUserPromptSubmitHook(userPromptHookContent)

		if (userPromptResult.cancel) {
			await this.host.handleHookCancellation("UserPromptSubmit", userPromptResult.wasCancelled)
			await this.host.cancelTask()
			return { cancel: true }
		}

		const userPromptContext = this.createHookContextBlock("UserPromptSubmit", userPromptResult.contextModification)
		if (userPromptContext) {
			contextBlocks.push(userPromptContext)
		}

		if (contextBlocks.length > 0) {
			return { context: contextBlocks.join("\n") }
		}

		return undefined
	}

	private createHookContextBlock(source: string, contextModification?: string): string | undefined {
		if (!contextModification) {
			return
		}

		const contextText = contextModification.trim()
		if (!contextText) {
			return
		}

		const lines = contextText.split("\n")
		const firstLine = lines[0]
		let contextType = "general"
		let content = contextText
		const typeMatch = /^([A-Z_]+):\s*(.*)/.exec(firstLine)
		if (typeMatch) {
			contextType = typeMatch[1].toLowerCase()
			const remainingLines = lines.slice(1).filter((line) => line.trim())
			content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
		}

		if (contextType === "general") {
			return `<hook_context source="${source}">\n${content}\n</hook_context>`
		}

		return `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`
	}

	private toHookParameters(input: unknown): Record<string, unknown> {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			return {}
		}
		return { ...(input as Record<string, unknown>) }
	}

	private toHookStringParameters(input: unknown): Record<string, string> {
		const params = this.toHookParameters(input)
		const entries = Object.entries(params).map(([key, value]) => {
			if (typeof value === "string") {
				return [key, value] as const
			}
			return [key, this.safeJsonStringify(value)] as const
		})
		return Object.fromEntries(entries)
	}

	private buildPendingToolInfo(toolName: string, input: unknown): Record<string, unknown> {
		const pendingToolInfo: Record<string, unknown> = { tool: toolName }
		const params = this.toHookParameters(input)

		for (const key of ["path", "command", "regex", "url", "tool_name", "server_name", "uri"]) {
			if (params[key] !== undefined) {
				pendingToolInfo[key] = params[key]
			}
		}

		if (typeof params.content === "string") {
			pendingToolInfo.content = params.content.slice(0, 200)
		}
		if (typeof params.diff === "string") {
			pendingToolInfo.diff = params.diff.slice(0, 200)
		}

		return pendingToolInfo
	}

	private safeJsonStringify(value: unknown): string {
		try {
			return JSON.stringify(value)
		} catch {
			return String(value)
		}
	}

	private resolveProviderConfig(providerInfo: ApiProviderInfo, apiConfig: ApiConfiguration): ProviderConnectionConfig {
		const { providerId, mode, model } = providerInfo
		switch (providerId) {
			case "anthropic":
				return { apiKey: apiConfig.apiKey, baseUrl: apiConfig.anthropicBaseUrl }
			case "openrouter":
				return { apiKey: apiConfig.openRouterApiKey }
			case "cline":
				return {
					apiKey: apiConfig.clineAccountId,
					knownModels:
						model?.id && model?.info ? { [model.id]: toRegisteredModelInfo(model.id, model.info) } : undefined,
				}
			case "openai":
				return {
					apiKey: apiConfig.openAiApiKey,
					baseUrl: apiConfig.openAiBaseUrl,
					headers: apiConfig.openAiHeaders,
				}
			case "gemini":
				return { apiKey: apiConfig.geminiApiKey, baseUrl: apiConfig.geminiBaseUrl }
			case "vertex":
				return { apiKey: apiConfig.geminiApiKey, baseUrl: apiConfig.geminiBaseUrl }
			case "ollama":
				return { apiKey: apiConfig.ollamaApiKey, baseUrl: apiConfig.ollamaBaseUrl }
			case "lmstudio":
				return { baseUrl: apiConfig.lmStudioBaseUrl }
			case "vscode-lm": {
				const selector =
					mode === "plan" ? apiConfig.planModeVsCodeLmModelSelector : apiConfig.actModeVsCodeLmModelSelector
				return {
					headers: selector ? { [VSCODE_LM_SELECTOR_HEADER]: JSON.stringify(selector) } : undefined,
				}
			}
			case "deepseek":
				return { apiKey: apiConfig.deepSeekApiKey }
			case "together":
				return { apiKey: apiConfig.togetherApiKey }
			case "litellm":
				return { apiKey: apiConfig.liteLlmApiKey, baseUrl: apiConfig.liteLlmBaseUrl }
			case "nebius":
				return { apiKey: apiConfig.nebiusApiKey }
			case "sambanova":
				return { apiKey: apiConfig.sambanovaApiKey }
			case "cerebras":
				return { apiKey: apiConfig.cerebrasApiKey }
			case "baseten":
				return { apiKey: apiConfig.basetenApiKey }
			case "huggingface":
				return { apiKey: apiConfig.huggingFaceApiKey }
			case "huawei-cloud-maas":
				return { apiKey: apiConfig.huaweiCloudMaasApiKey }
			case "vercel-ai-gateway":
				return { apiKey: apiConfig.vercelAiGatewayApiKey }
			case "aihubmix":
				return {
					apiKey: apiConfig.aihubmixApiKey,
					baseUrl: apiConfig.aihubmixBaseUrl,
					headers: apiConfig.aihubmixAppCode ? { "APP-Code": apiConfig.aihubmixAppCode } : undefined,
				}
			case "hicap":
				return {
					apiKey: apiConfig.hicapApiKey,
					headers: apiConfig.hicapApiKey ? { "api-key": apiConfig.hicapApiKey } : undefined,
				}
			case "nousResearch":
				return { apiKey: apiConfig.nousResearchApiKey }
			case "requesty":
				return { apiKey: apiConfig.requestyApiKey, baseUrl: apiConfig.requestyBaseUrl }
			case "xai":
				return { apiKey: apiConfig.xaiApiKey }
			case "groq":
				return { apiKey: apiConfig.groqApiKey }
			case "fireworks":
				return { apiKey: apiConfig.fireworksApiKey }
			default:
				Logger.warn(`[Task ${this.host.taskId}] No explicit provider config mapping for provider "${providerId}"`)
				return {}
		}
	}
}
