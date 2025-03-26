import * as vscode from "vscode"

import { EventEmitter } from "events"

export interface TokenUsage {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number
	totalCacheReads?: number
	totalCost: number
	contextTokens: number
}

export interface RooCodeEvents {
	message: [{ taskId: string; action: "created" | "updated"; message: ClineMessage }]
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

export interface RooCodeAPI extends EventEmitter<RooCodeEvents> {
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
	 * Sets the configuration for the current task.
	 * @param values An object containing key-value pairs to set.
	 */
	setConfiguration(values: Partial<ConfigurationValues>): Promise<void>

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

export type ClineAsk =
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

export type ClineSay =
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

export interface ClineMessage {
	ts: number
	type: "ask" | "say"
	ask?: ClineAsk
	say?: ClineSay
	text?: string
	images?: string[]
	partial?: boolean
	reasoning?: string
	conversationHistoryIndex?: number
	checkpoint?: Record<string, unknown>
	progressStatus?: ToolProgressStatus
}

export interface ModelInfo {
	maxTokens?: number
	contextWindow: number
	supportsImages?: boolean
	supportsComputerUse?: boolean
	supportsPromptCache: boolean // This value is hardcoded for now.
	inputPrice?: number
	outputPrice?: number
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	description?: string
	reasoningEffort?: "low" | "medium" | "high"
	thinking?: boolean
}

export interface ApiConfigMeta {
	id: string
	name: string
	apiProvider?: ProviderName
}

export type HistoryItem = {
	id: string
	number: number
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	size?: number
}

export type ExperimentId =
	| "experimentalDiffStrategy"
	| "search_and_replace"
	| "insert_content"
	| "powerSteering"
	| "multi_search_and_replace"

export type CheckpointStorage = "task" | "workspace"

export type GroupOptions = {
	fileRegex?: string // Regular expression pattern.
	description?: string // Human-readable description of the pattern.
}

export type ToolGroup = "read" | "edit" | "browser" | "command" | "mcp" | "modes"

export type GroupEntry = ToolGroup | readonly [ToolGroup, GroupOptions]

export type ModeConfig = {
	slug: string
	name: string
	roleDefinition: string
	customInstructions?: string
	groups: readonly GroupEntry[] // Now supports both simple strings and tuples with options
	source?: "global" | "project" // Where this mode was loaded from
}

export type PromptComponent = {
	roleDefinition?: string
	customInstructions?: string
}

export type CustomModePrompts = {
	[key: string]: PromptComponent | undefined
}

export type CustomSupportPrompts = {
	[key: string]: string | undefined
}

export type TelemetrySetting = "unset" | "enabled" | "disabled"

export type Language =
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

/**
 * GlobalSettings
 *
 * These are settings that apply globally.
 * They are all stored in the global state.
 */

export interface GlobalSettings {
	currentApiConfigName?: string
	listApiConfigMeta?: ApiConfigMeta[]
	pinnedApiConfigs?: Record<string, boolean>

	lastShownAnnouncementId?: string
	customInstructions?: string
	taskHistory?: HistoryItem[]

	autoApprovalEnabled?: boolean
	alwaysAllowReadOnly?: boolean
	alwaysAllowReadOnlyOutsideWorkspace?: boolean
	alwaysAllowWrite?: boolean
	alwaysAllowWriteOutsideWorkspace?: boolean
	writeDelayMs?: number
	alwaysAllowBrowser?: boolean
	alwaysApproveResubmit?: boolean
	requestDelaySeconds?: number
	alwaysAllowMcp?: boolean
	alwaysAllowModeSwitch?: boolean
	alwaysAllowSubtasks?: boolean
	alwaysAllowExecute?: boolean
	allowedCommands?: string[]

	browserToolEnabled?: boolean
	browserViewportSize?: string
	screenshotQuality?: number
	remoteBrowserEnabled?: boolean
	remoteBrowserHost?: string

	enableCheckpoints?: boolean
	checkpointStorage?: CheckpointStorage

	ttsEnabled?: boolean
	ttsSpeed?: number
	soundEnabled?: boolean
	soundVolume?: number

	maxOpenTabsContext?: number
	maxWorkspaceFiles?: number
	showRooIgnoredFiles?: boolean
	maxReadFileLine?: number

	terminalOutputLineLimit?: number
	terminalShellIntegrationTimeout?: number

	rateLimitSeconds?: number
	diffEnabled?: boolean
	fuzzyMatchThreshold?: number
	experiments?: Record<ExperimentId, boolean> // Map of experiment IDs to their enabled state.

	language?: Language

	telemetrySetting?: TelemetrySetting

	mcpEnabled?: boolean
	enableMcpServerCreation?: boolean

	mode?: string
	modeApiConfigs?: Record<string, string>
	customModes?: ModeConfig[]
	customModePrompts?: CustomModePrompts
	customSupportPrompts?: CustomSupportPrompts
	enhancementApiConfigId?: string
}

export type GlobalSettingsKey = keyof GlobalSettings

/**
 * ProviderSettings
 *
 * These are settings that apply on a per-provider basis.
 * Non-sensitive values  are stored in the global state.
 * Sensitive values are stored in VSCode secrets.
 */

/**
 * DiscriminatedProviderSettings
 *
 * NOTE: This is actually how our provider settings should be typed, but it
 * will take a little elbow grease to move to this shape. For now we're just
 * using it to generate the `ProviderName`.
 */

export type DiscriminatedProviderSettings =
	| {
			apiProvider: "anthropic"
			apiKey?: string
			anthropicBaseUrl?: string
			apiModelId?: string
	  }
	| {
			apiProvider: "glama"
			glamaApiKey?: string
			glamaModelId?: string
	  }
	| {
			apiProvider: "openrouter"
			openRouterApiKey?: string
			openRouterModelId?: string
			openRouterBaseUrl?: string
			openRouterSpecificProvider?: string
			openRouterUseMiddleOutTransform?: boolean
	  }
	| {
			apiProvider: "bedrock"
			awsAccessKey?: string
			awsSecretKey?: string
			awsSessionToken?: string
			awsRegion?: string
			awsUseCrossRegionInference?: boolean
			awsUsePromptCache?: boolean
			awspromptCacheId?: string
			awsProfile?: string
			awsUseProfile?: boolean
			awsCustomArn?: string
	  }
	| {
			apiProvider: "vertex"
			vertexKeyFile?: string
			vertexJsonCredentials?: string
			vertexProjectId?: string
			vertexRegion?: string
	  }
	| {
			apiProvider: "openai"
			openAiApiKey?: string
			openAiBaseUrl?: string
			openAiR1FormatEnabled?: boolean
			openAiModelId?: string
			openAiUseAzure?: boolean
			azureApiVersion?: string
			openAiStreamingEnabled?: boolean
	  }
	| {
			apiProvider: "ollama"
			ollamaModelId?: string
			ollamaBaseUrl?: string
	  }
	| {
			apiProvider: "vscode-lm"
			vsCodeLmModelSelector?: vscode.LanguageModelChatSelector
	  }
	| {
			apiProvider: "lmstudio"
			lmStudioModelId?: string
			lmStudioBaseUrl?: string
			lmStudioDraftModelId?: string
			lmStudioSpeculativeDecodingEnabled?: boolean
	  }
	| {
			apiProvider: "gemini"
			googleGeminiBaseUrl?: string
	  }
	| {
			apiProvider: "openai-native"
			openAiNativeApiKey?: string
	  }
	| {
			apiProvider: "mistral"
			mistralApiKey?: string
			mistralCodestralUrl?: string
	  }
	| {
			apiProvider: "deepseek"
			deepSeekApiKey?: string
			deepSeekBaseUrl?: string
	  }
	| {
			apiProvider: "unbound"
			unboundApiKey?: string
			unboundModelId?: string
	  }
	| {
			apiProvider: "requesty"
			requestyApiKey?: string
			requestyModelId?: string
	  }
	| {
			apiProvider: "human-relay"
	  }
	| {
			apiProvider: "fake-ai"
			fakeAi?: unknown
	  }

export type ProviderName = DiscriminatedProviderSettings["apiProvider"]

export interface ProviderSettings {
	apiProvider?: ProviderName
	apiModelId?: string
	// Anthropic
	apiKey?: string // secret
	anthropicBaseUrl?: string
	// Glama
	glamaApiKey?: string // secret
	glamaModelId?: string
	glamaModelInfo?: ModelInfo
	// OpenRouter
	openRouterApiKey?: string // secret
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	openRouterBaseUrl?: string
	openRouterSpecificProvider?: string
	openRouterUseMiddleOutTransform?: boolean
	// AWS Bedrock
	awsAccessKey?: string // secret
	awsSecretKey?: string // secret
	awsSessionToken?: string // secret
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
	awsUsePromptCache?: boolean
	awspromptCacheId?: string
	awsProfile?: string
	awsUseProfile?: boolean
	awsCustomArn?: string
	// Google Vertex
	vertexKeyFile?: string
	vertexJsonCredentials?: string
	vertexProjectId?: string
	vertexRegion?: string
	// OpenAI
	openAiApiKey?: string // secret
	openAiBaseUrl?: string
	openAiR1FormatEnabled?: boolean
	openAiModelId?: string
	openAiCustomModelInfo?: ModelInfo
	openAiUseAzure?: boolean
	azureApiVersion?: string
	openAiStreamingEnabled?: boolean
	// Ollama
	ollamaModelId?: string
	ollamaBaseUrl?: string
	// VS Code LM
	vsCodeLmModelSelector?: vscode.LanguageModelChatSelector
	// LM Studio
	lmStudioModelId?: string
	lmStudioBaseUrl?: string
	lmStudioDraftModelId?: string
	lmStudioSpeculativeDecodingEnabled?: boolean
	// Gemini
	geminiApiKey?: string // secret
	googleGeminiBaseUrl?: string
	// OpenAI Native
	openAiNativeApiKey?: string // secret
	// Mistral
	mistralApiKey?: string // secret
	mistralCodestralUrl?: string // New option for Codestral URL.
	// DeepSeek
	deepSeekApiKey?: string // secret
	deepSeekBaseUrl?: string
	// Unbound
	unboundApiKey?: string // secret
	unboundModelId?: string
	unboundModelInfo?: ModelInfo
	// Requesty
	requestyApiKey?: string
	requestyModelId?: string
	requestyModelInfo?: ModelInfo
	// Claude 3.7 Sonnet Thinking
	modelTemperature?: number | null
	modelMaxTokens?: number
	modelMaxThinkingTokens?: number
	// Generic (For now though, OpenAI, DeekSeek, Mistral, and Requesty make reference to it.)
	includeMaxTokens?: boolean
	// Fake AI
	fakeAi?: unknown
}

export type ProviderSettingsKey = keyof ProviderSettings

/**
 * RooCodeSettings
 *
 * All settings, irrespective of scope and storage.
 */

export type RooCodeSettings = GlobalSettings & ProviderSettings

export type RooCodeSettingsKey = keyof RooCodeSettings

/**
 * SecretState
 *
 * All settings that are stored in VSCode secrets.
 */

export type SecretState = Pick<
	RooCodeSettings,
	| "apiKey"
	| "glamaApiKey"
	| "openRouterApiKey"
	| "awsAccessKey"
	| "awsSecretKey"
	| "awsSessionToken"
	| "openAiApiKey"
	| "geminiApiKey"
	| "openAiNativeApiKey"
	| "deepSeekApiKey"
	| "mistralApiKey"
	| "unboundApiKey"
	| "requestyApiKey"
>

export type SecretStateKey = keyof SecretState

/**
 * GlobalState
 *
 * All settings that are stored in the global state.
 */

export type GlobalState = Omit<RooCodeSettings, SecretStateKey>

export type GlobalStateKey = keyof GlobalState
