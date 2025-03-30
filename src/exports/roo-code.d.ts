import { EventEmitter } from "events"

type ProviderSettings = {
	apiProvider?:
		| (
				| "anthropic"
				| "glama"
				| "openrouter"
				| "bedrock"
				| "vertex"
				| "openai"
				| "ollama"
				| "vscode-lm"
				| "lmstudio"
				| "gemini"
				| "openai-native"
				| "mistral"
				| "deepseek"
				| "unbound"
				| "requesty"
				| "human-relay"
				| "fake-ai"
		  )
		| undefined
	apiModelId?: string | undefined
	apiKey?: string | undefined
	anthropicBaseUrl?: string | undefined
	glamaModelId?: string | undefined
	glamaModelInfo?:
		| ({
				maxTokens?: number | undefined
				contextWindow: number
				supportsImages?: boolean | undefined
				supportsComputerUse?: boolean | undefined
				supportsPromptCache: boolean
				inputPrice?: number | undefined
				outputPrice?: number | undefined
				cacheWritesPrice?: number | undefined
				cacheReadsPrice?: number | undefined
				description?: string | undefined
				reasoningEffort?: ("low" | "medium" | "high") | undefined
				thinking?: boolean | undefined
		  } | null)
		| undefined
	glamaApiKey?: string | undefined
	openRouterApiKey?: string | undefined
	openRouterModelId?: string | undefined
	openRouterModelInfo?:
		| ({
				maxTokens?: number | undefined
				contextWindow: number
				supportsImages?: boolean | undefined
				supportsComputerUse?: boolean | undefined
				supportsPromptCache: boolean
				inputPrice?: number | undefined
				outputPrice?: number | undefined
				cacheWritesPrice?: number | undefined
				cacheReadsPrice?: number | undefined
				description?: string | undefined
				reasoningEffort?: ("low" | "medium" | "high") | undefined
				thinking?: boolean | undefined
		  } | null)
		| undefined
	openRouterBaseUrl?: string | undefined
	openRouterSpecificProvider?: string | undefined
	openRouterUseMiddleOutTransform?: boolean | undefined
	awsAccessKey?: string | undefined
	awsSecretKey?: string | undefined
	awsSessionToken?: string | undefined
	awsRegion?: string | undefined
	awsUseCrossRegionInference?: boolean | undefined
	awsUsePromptCache?: boolean | undefined
	awspromptCacheId?: string | undefined
	awsProfile?: string | undefined
	awsUseProfile?: boolean | undefined
	awsCustomArn?: string | undefined
	vertexKeyFile?: string | undefined
	vertexJsonCredentials?: string | undefined
	vertexProjectId?: string | undefined
	vertexRegion?: string | undefined
	openAiBaseUrl?: string | undefined
	openAiApiKey?: string | undefined
	openAiR1FormatEnabled?: boolean | undefined
	openAiModelId?: string | undefined
	openAiCustomModelInfo?:
		| ({
				maxTokens?: number | undefined
				contextWindow: number
				supportsImages?: boolean | undefined
				supportsComputerUse?: boolean | undefined
				supportsPromptCache: boolean
				inputPrice?: number | undefined
				outputPrice?: number | undefined
				cacheWritesPrice?: number | undefined
				cacheReadsPrice?: number | undefined
				description?: string | undefined
				reasoningEffort?: ("low" | "medium" | "high") | undefined
				thinking?: boolean | undefined
		  } | null)
		| undefined
	openAiUseAzure?: boolean | undefined
	azureApiVersion?: string | undefined
	openAiStreamingEnabled?: boolean | undefined
	ollamaModelId?: string | undefined
	ollamaBaseUrl?: string | undefined
	vsCodeLmModelSelector?:
		| {
				vendor?: string | undefined
				family?: string | undefined
				version?: string | undefined
				id?: string | undefined
		  }
		| undefined
	lmStudioModelId?: string | undefined
	lmStudioBaseUrl?: string | undefined
	lmStudioDraftModelId?: string | undefined
	lmStudioSpeculativeDecodingEnabled?: boolean | undefined
	geminiApiKey?: string | undefined
	googleGeminiBaseUrl?: string | undefined
	openAiNativeApiKey?: string | undefined
	mistralApiKey?: string | undefined
	mistralCodestralUrl?: string | undefined
	deepSeekBaseUrl?: string | undefined
	deepSeekApiKey?: string | undefined
	unboundApiKey?: string | undefined
	unboundModelId?: string | undefined
	unboundModelInfo?:
		| ({
				maxTokens?: number | undefined
				contextWindow: number
				supportsImages?: boolean | undefined
				supportsComputerUse?: boolean | undefined
				supportsPromptCache: boolean
				inputPrice?: number | undefined
				outputPrice?: number | undefined
				cacheWritesPrice?: number | undefined
				cacheReadsPrice?: number | undefined
				description?: string | undefined
				reasoningEffort?: ("low" | "medium" | "high") | undefined
				thinking?: boolean | undefined
		  } | null)
		| undefined
	requestyApiKey?: string | undefined
	requestyModelId?: string | undefined
	requestyModelInfo?:
		| ({
				maxTokens?: number | undefined
				contextWindow: number
				supportsImages?: boolean | undefined
				supportsComputerUse?: boolean | undefined
				supportsPromptCache: boolean
				inputPrice?: number | undefined
				outputPrice?: number | undefined
				cacheWritesPrice?: number | undefined
				cacheReadsPrice?: number | undefined
				description?: string | undefined
				reasoningEffort?: ("low" | "medium" | "high") | undefined
				thinking?: boolean | undefined
		  } | null)
		| undefined
	modelTemperature?: (number | null) | undefined
	modelMaxTokens?: number | undefined
	modelMaxThinkingTokens?: number | undefined
	includeMaxTokens?: boolean | undefined
	fakeAi?: unknown | undefined
}

type GlobalSettings = {
	currentApiConfigName?: string | undefined
	listApiConfigMeta?:
		| {
				id: string
				name: string
				apiProvider?:
					| (
							| "anthropic"
							| "glama"
							| "openrouter"
							| "bedrock"
							| "vertex"
							| "openai"
							| "ollama"
							| "vscode-lm"
							| "lmstudio"
							| "gemini"
							| "openai-native"
							| "mistral"
							| "deepseek"
							| "unbound"
							| "requesty"
							| "human-relay"
							| "fake-ai"
					  )
					| undefined
		  }[]
		| undefined
	pinnedApiConfigs?:
		| {
				[x: string]: boolean
		  }
		| undefined
	lastShownAnnouncementId?: string | undefined
	customInstructions?: string | undefined
	taskHistory?:
		| {
				id: string
				number: number
				ts: number
				task: string
				tokensIn: number
				tokensOut: number
				cacheWrites?: number | undefined
				cacheReads?: number | undefined
				totalCost: number
				size?: number | undefined
		  }[]
		| undefined
	autoApprovalEnabled?: boolean | undefined
	alwaysAllowReadOnly?: boolean | undefined
	alwaysAllowReadOnlyOutsideWorkspace?: boolean | undefined
	alwaysAllowWrite?: boolean | undefined
	alwaysAllowWriteOutsideWorkspace?: boolean | undefined
	writeDelayMs?: number | undefined
	alwaysAllowBrowser?: boolean | undefined
	alwaysApproveResubmit?: boolean | undefined
	requestDelaySeconds?: number | undefined
	alwaysAllowMcp?: boolean | undefined
	alwaysAllowModeSwitch?: boolean | undefined
	alwaysAllowSubtasks?: boolean | undefined
	alwaysAllowExecute?: boolean | undefined
	allowedCommands?: string[] | undefined
	browserToolEnabled?: boolean | undefined
	browserViewportSize?: string | undefined
	screenshotQuality?: number | undefined
	remoteBrowserEnabled?: boolean | undefined
	remoteBrowserHost?: string | undefined
	cachedChromeHostUrl?: string | undefined
	enableCheckpoints?: boolean | undefined
	checkpointStorage?: ("task" | "workspace") | undefined
	ttsEnabled?: boolean | undefined
	ttsSpeed?: number | undefined
	soundEnabled?: boolean | undefined
	soundVolume?: number | undefined
	maxOpenTabsContext?: number | undefined
	maxWorkspaceFiles?: number | undefined
	showRooIgnoredFiles?: boolean | undefined
	maxReadFileLine?: number | undefined
	terminalOutputLineLimit?: number | undefined
	terminalShellIntegrationTimeout?: number | undefined
	rateLimitSeconds?: number | undefined
	diffEnabled?: boolean | undefined
	fuzzyMatchThreshold?: number | undefined
	experiments?:
		| {
				search_and_replace: boolean
				experimentalDiffStrategy: boolean
				multi_search_and_replace: boolean
				insert_content: boolean
				powerSteering: boolean
		  }
		| undefined
	language?:
		| (
				| "ca"
				| "de"
				| "en"
				| "es"
				| "fr"
				| "hi"
				| "it"
				| "ja"
				| "ko"
				| "pl"
				| "pt-BR"
				| "tr"
				| "vi"
				| "zh-CN"
				| "zh-TW"
		  )
		| undefined
	telemetrySetting?: ("unset" | "enabled" | "disabled") | undefined
	mcpEnabled?: boolean | undefined
	enableMcpServerCreation?: boolean | undefined
	mode?: string | undefined
	modeApiConfigs?:
		| {
				[x: string]: string
		  }
		| undefined
	customModes?:
		| {
				slug: string
				name: string
				roleDefinition: string
				customInstructions?: string | undefined
				groups: (
					| ("read" | "edit" | "browser" | "command" | "mcp" | "modes")
					| [
							"read" | "edit" | "browser" | "command" | "mcp" | "modes",
							{
								fileRegex?: string | undefined
								description?: string | undefined
							},
					  ]
				)[]
				source?: ("global" | "project") | undefined
		  }[]
		| undefined
	customModePrompts?:
		| {
				[x: string]:
					| {
							roleDefinition?: string | undefined
							customInstructions?: string | undefined
					  }
					| undefined
		  }
		| undefined
	customSupportPrompts?:
		| {
				[x: string]: string | undefined
		  }
		| undefined
	enhancementApiConfigId?: string | undefined
}

type ClineMessage = {
	ts: number
	type: "ask" | "say"
	ask?:
		| (
				| "followup"
				| "command"
				| "command_output"
				| "completion_result"
				| "tool"
				| "api_req_failed"
				| "resume_task"
				| "resume_completed_task"
				| "mistake_limit_reached"
				| "browser_action_launch"
				| "use_mcp_server"
				| "finishTask"
		  )
		| undefined
	say?:
		| (
				| "task"
				| "error"
				| "api_req_started"
				| "api_req_finished"
				| "api_req_retried"
				| "api_req_retry_delayed"
				| "api_req_deleted"
				| "text"
				| "reasoning"
				| "completion_result"
				| "user_feedback"
				| "user_feedback_diff"
				| "command_output"
				| "tool"
				| "shell_integration_warning"
				| "browser_action"
				| "browser_action_result"
				| "command"
				| "mcp_server_request_started"
				| "mcp_server_response"
				| "new_task_started"
				| "new_task"
				| "checkpoint_saved"
				| "rooignore_error"
		  )
		| undefined
	text?: string | undefined
	images?: string[] | undefined
	partial?: boolean | undefined
	reasoning?: string | undefined
	conversationHistoryIndex?: number | undefined
	checkpoint?:
		| {
				[x: string]: unknown
		  }
		| undefined
	progressStatus?:
		| {
				icon?: string | undefined
				text?: string | undefined
		  }
		| undefined
}

type TokenUsage = {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number | undefined
	totalCacheReads?: number | undefined
	totalCost: number
	contextTokens: number
}

type RooCodeSettings = GlobalSettings & ProviderSettings

interface RooCodeEvents {
	message: [
		{
			taskId: string
			action: "created" | "updated"
			message: ClineMessage
		},
	]
	taskCreated: [taskId: string]
	taskStarted: [taskId: string]
	taskPaused: [taskId: string]
	taskUnpaused: [taskId: string]
	taskAskResponded: [taskId: string]
	taskAborted: [taskId: string]
	taskSpawned: [taskId: string, childTaskId: string]
	taskCompleted: [taskId: string, usage: TokenUsage]
	taskTokenUsageUpdated: [taskId: string, usage: TokenUsage]
}
interface RooCodeAPI extends EventEmitter<RooCodeEvents> {
	/**
	 * Starts a new task with an optional initial message and images.
	 * @param task Optional initial task message.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 * @returns The ID of the new task.
	 */
	startNewTask(task?: string, images?: string[]): Promise<string>
	/**
	 * Returns the current task stack.
	 * @returns An array of task IDs.
	 */
	getCurrentTaskStack(): string[]
	/**
	 * Clears the current task.
	 */
	clearCurrentTask(lastMessage?: string): Promise<void>
	/**
	 * Cancels the current task.
	 */
	cancelCurrentTask(): Promise<void>
	/**
	 * Sends a message to the current task.
	 * @param message Optional message to send.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 */
	sendMessage(message?: string, images?: string[]): Promise<void>
	/**
	 * Simulates pressing the primary button in the chat interface.
	 */
	pressPrimaryButton(): Promise<void>
	/**
	 * Simulates pressing the secondary button in the chat interface.
	 */
	pressSecondaryButton(): Promise<void>
	/**
	 * Returns the current configuration.
	 * @returns The current configuration.
	 */
	getConfiguration(): RooCodeSettings
	/**
	 * Returns the value of a configuration key.
	 * @param key The key of the configuration value to return.
	 * @returns The value of the configuration key.
	 */
	getConfigurationValue<K extends keyof RooCodeSettings>(key: K): RooCodeSettings[K]
	/**
	 * Sets the configuration for the current task.
	 * @param values An object containing key-value pairs to set.
	 */
	setConfiguration(values: RooCodeSettings): Promise<void>
	/**
	 * Sets the value of a configuration key.
	 * @param key The key of the configuration value to set.
	 * @param value The value to set.
	 */
	setConfigurationValue<K extends keyof RooCodeSettings>(key: K, value: RooCodeSettings[K]): Promise<void>
	/**
	 * Returns true if the API is ready to use.
	 */
	isReady(): boolean
	/**
	 * Returns the messages for a given task.
	 * @param taskId The ID of the task.
	 * @returns An array of ClineMessage objects.
	 */
	getMessages(taskId: string): ClineMessage[]
	/**
	 * Returns the token usage for a given task.
	 * @param taskId The ID of the task.
	 * @returns A TokenUsage object.
	 */
	getTokenUsage(taskId: string): TokenUsage
	/**
	 * Logs a message to the output channel.
	 * @param message The message to log.
	 */
	log(message: string): void
}

export type { ClineMessage, GlobalSettings, ProviderSettings, RooCodeAPI, RooCodeEvents, RooCodeSettings, TokenUsage }
