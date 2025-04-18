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
				| "xai"
		  )
		| undefined
	apiModelId?: string | undefined
	apiKey?: string | undefined
	anthropicBaseUrl?: string | undefined
	anthropicUseAuthToken?: boolean | undefined
	glamaModelId?: string | undefined
	glamaModelInfo?:
		| ({
				maxTokens?: (number | null) | undefined
				maxThinkingTokens?: (number | null) | undefined
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
				minTokensPerCachePoint?: number | undefined
				maxCachePoints?: number | undefined
				cachableFields?: string[] | undefined
		  } | null)
		| undefined
	glamaApiKey?: string | undefined
	openRouterApiKey?: string | undefined
	openRouterModelId?: string | undefined
	openRouterModelInfo?:
		| ({
				maxTokens?: (number | null) | undefined
				maxThinkingTokens?: (number | null) | undefined
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
				minTokensPerCachePoint?: number | undefined
				maxCachePoints?: number | undefined
				cachableFields?: string[] | undefined
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
	openAiHostHeader?: string | undefined
	openAiLegacyFormat?: boolean | undefined
	openAiR1FormatEnabled?: boolean | undefined
	openAiModelId?: string | undefined
	openAiCustomModelInfo?:
		| ({
				maxTokens?: (number | null) | undefined
				maxThinkingTokens?: (number | null) | undefined
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
				minTokensPerCachePoint?: number | undefined
				maxCachePoints?: number | undefined
				cachableFields?: string[] | undefined
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
				maxTokens?: (number | null) | undefined
				maxThinkingTokens?: (number | null) | undefined
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
				minTokensPerCachePoint?: number | undefined
				maxCachePoints?: number | undefined
				cachableFields?: string[] | undefined
		  } | null)
		| undefined
	requestyApiKey?: string | undefined
	requestyModelId?: string | undefined
	requestyModelInfo?:
		| ({
				maxTokens?: (number | null) | undefined
				maxThinkingTokens?: (number | null) | undefined
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
				minTokensPerCachePoint?: number | undefined
				maxCachePoints?: number | undefined
				cachableFields?: string[] | undefined
		  } | null)
		| undefined
	xaiApiKey?: string | undefined
	modelMaxTokens?: number | undefined
	modelMaxThinkingTokens?: number | undefined
	includeMaxTokens?: boolean | undefined
	modelTemperature?: (number | null) | undefined
	reasoningEffort?: ("low" | "medium" | "high") | undefined
	rateLimitSeconds?: number | undefined
	diffEnabled?: boolean | undefined
	fuzzyMatchThreshold?: number | undefined
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
							| "xai"
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
				workspace?: string | undefined
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
	terminalCommandDelay?: number | undefined
	terminalPowershellCounter?: boolean | undefined
	terminalZshClearEolMark?: boolean | undefined
	terminalZshOhMy?: boolean | undefined
	terminalZshP10k?: boolean | undefined
	terminalZdotdir?: boolean | undefined
	rateLimitSeconds?: number | undefined
	diffEnabled?: boolean | undefined
	fuzzyMatchThreshold?: number | undefined
	experiments?:
		| {
				search_and_replace: boolean
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
				| "subtask_result"
				| "checkpoint_saved"
				| "rooignore_error"
				| "diff_error"
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

type RooCodeEvents = {
	message: [
		{
			taskId: string
			action: "created" | "updated"
			message: {
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
							| "subtask_result"
							| "checkpoint_saved"
							| "rooignore_error"
							| "diff_error"
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
		},
	]
	taskCreated: [string]
	taskStarted: [string]
	taskModeSwitched: [string, string]
	taskPaused: [string]
	taskUnpaused: [string]
	taskAskResponded: [string]
	taskAborted: [string]
	taskSpawned: [string, string]
	taskCompleted: [
		string,
		{
			totalTokensIn: number
			totalTokensOut: number
			totalCacheWrites?: number | undefined
			totalCacheReads?: number | undefined
			totalCost: number
			contextTokens: number
		},
		{
			[x: string]: {
				attempts: number
				failures: number
			}
		},
	]
	taskTokenUsageUpdated: [
		string,
		{
			totalTokensIn: number
			totalTokensOut: number
			totalCacheWrites?: number | undefined
			totalCacheReads?: number | undefined
			totalCost: number
			contextTokens: number
		},
	]
}

/**
 * RooCodeEvent
 */
declare enum RooCodeEventName {
	Message = "message",
	TaskCreated = "taskCreated",
	TaskStarted = "taskStarted",
	TaskModeSwitched = "taskModeSwitched",
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskAskResponded = "taskAskResponded",
	TaskAborted = "taskAborted",
	TaskSpawned = "taskSpawned",
	TaskCompleted = "taskCompleted",
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
}

type RooCodeSettings = GlobalSettings & ProviderSettings
interface RooCodeAPI extends EventEmitter<RooCodeEvents> {
	/**
	 * Starts a new task with an optional initial message and images.
	 * @param task Optional initial task message.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 * @returns The ID of the new task.
	 */
	startNewTask({
		configuration,
		text,
		images,
		newTab,
	}: {
		configuration?: RooCodeSettings
		text?: string
		images?: string[]
		newTab?: boolean
	}): Promise<string>
	/**
	 * Resumes a task with the given ID.
	 * @param taskId The ID of the task to resume.
	 * @throws Error if the task is not found in the task history.
	 */
	resumeTask(taskId: string): Promise<void>
	/**
	 * Checks if a task with the given ID is in the task history.
	 * @param taskId The ID of the task to check.
	 * @returns True if the task is in the task history, false otherwise.
	 */
	isTaskInHistory(taskId: string): Promise<boolean>
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
	 * Sets the configuration for the current task.
	 * @param values An object containing key-value pairs to set.
	 */
	setConfiguration(values: RooCodeSettings): Promise<void>
	/**
	 * Creates a new API configuration profile
	 * @param name The name of the profile
	 * @returns The ID of the created profile
	 */
	createProfile(name: string): Promise<string>
	/**
	 * Returns a list of all configured profile names
	 * @returns Array of profile names
	 */
	getProfiles(): string[]
	/**
	 * Changes the active API configuration profile
	 * @param name The name of the profile to activate
	 * @throws Error if the profile does not exist
	 */
	setActiveProfile(name: string): Promise<void>
	/**
	 * Returns the name of the currently active profile
	 * @returns The profile name, or undefined if no profile is active
	 */
	getActiveProfile(): string | undefined
	/**
	 * Deletes a profile by name
	 * @param name The name of the profile to delete
	 * @throws Error if the profile does not exist
	 */
	deleteProfile(name: string): Promise<void>
	/**
	 * Returns true if the API is ready to use.
	 */
	isReady(): boolean
}

export {
	type ClineMessage,
	type GlobalSettings,
	type ProviderSettings,
	type RooCodeAPI,
	RooCodeEventName,
	type RooCodeEvents,
	type RooCodeSettings,
	type TokenUsage,
}
