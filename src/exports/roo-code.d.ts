export interface RooCodeAPI {
	/**
	 * Starts a new task with an optional initial message and images.
	 * @param task Optional initial task message.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 */
	startNewTask(task?: string, images?: string[]): Promise<void>

	/**
	 * Cancels the current task.
	 */
	cancelTask(): Promise<void>

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
	 * Returns the messages from the current task.
	 */
	getMessages(): ClineMessage[]
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

export type SecretKey =
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

export type GlobalStateKey =
	| "apiProvider"
	| "apiModelId"
	| "glamaModelId"
	| "glamaModelInfo"
	| "awsRegion"
	| "awsUseCrossRegionInference"
	| "awsProfile"
	| "awsUseProfile"
	| "awsCustomArn"
	| "vertexKeyFile"
	| "vertexJsonCredentials"
	| "vertexProjectId"
	| "vertexRegion"
	| "lastShownAnnouncementId"
	| "customInstructions"
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowExecute"
	| "alwaysAllowBrowser"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "taskHistory"
	| "openAiBaseUrl"
	| "openAiModelId"
	| "openAiCustomModelInfo"
	| "openAiUseAzure"
	| "ollamaModelId"
	| "ollamaBaseUrl"
	| "lmStudioModelId"
	| "lmStudioBaseUrl"
	| "anthropicBaseUrl"
	| "modelMaxThinkingTokens"
	| "azureApiVersion"
	| "openAiStreamingEnabled"
	| "openRouterModelId"
	| "openRouterModelInfo"
	| "openRouterBaseUrl"
	| "openRouterUseMiddleOutTransform"
	| "allowedCommands"
	| "soundEnabled"
	| "soundVolume"
	| "diffEnabled"
	| "enableCheckpoints"
	| "checkpointStorage"
	| "browserViewportSize"
	| "screenshotQuality"
	| "remoteBrowserHost"
	| "fuzzyMatchThreshold"
	| "writeDelayMs"
	| "terminalOutputLineLimit"
	| "mcpEnabled"
	| "enableMcpServerCreation"
	| "alwaysApproveResubmit"
	| "requestDelaySeconds"
	| "rateLimitSeconds"
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "vsCodeLmModelSelector"
	| "mode"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "experiments" // Map of experiment IDs to their enabled state
	| "autoApprovalEnabled"
	| "enableCustomModeCreation" // Enable the ability for Roo to create custom modes
	| "customModes" // Array of custom modes
	| "unboundModelId"
	| "requestyModelId"
	| "requestyModelInfo"
	| "unboundModelInfo"
	| "modelTemperature"
	| "modelMaxTokens"
	| "mistralCodestralUrl"
	| "maxOpenTabsContext"
	| "browserToolEnabled"
	| "lmStudioSpeculativeDecodingEnabled"
	| "lmStudioDraftModelId"
	| "telemetrySetting"
	| "showRooIgnoredFiles"
	| "remoteBrowserEnabled"

export type ConfigurationKey = GlobalStateKey | SecretKey

export type ConfigurationValues = Record<ConfigurationKey, any>
