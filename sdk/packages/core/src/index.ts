/**
 * @clinebot/core
 *
 * Runtime-agnostic core contracts and shared state utilities.
 */

export {
	type AgentConfig,
	type CreateMcpToolsOptions,
	createMcpTools,
	createTool,
	getClineDefaultSystemPrompt,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolContext,
} from "@clinebot/agents";
export * as LlmsModels from "@clinebot/llms/models";
export * as LlmsProviders from "@clinebot/llms/providers";
// Shared contracts and path helpers re-exported for app consumers.
export type {
	AgentMode,
	BasicLogger,
	ConnectorHookEvent,
	HookSessionContext,
	ITelemetryService,
	RpcAddProviderActionRequest,
	RpcChatMessage,
	RpcChatRunTurnRequest,
	RpcChatRuntimeConfigBase,
	RpcChatRuntimeLoggerConfig,
	RpcChatStartSessionArtifacts,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
	RpcClineAccountActionRequest,
	RpcOAuthProviderId,
	RpcProviderActionRequest,
	RpcProviderCapability,
	RpcProviderCatalogResponse,
	RpcProviderListItem,
	RpcProviderModel,
	RpcProviderOAuthLoginResponse,
	RpcSaveProviderSettingsActionRequest,
	SessionLineage,
	TeamProgressProjectionEvent,
	TelemetryArray,
	TelemetryMetadata,
	TelemetryObject,
	TelemetryPrimitive,
	TelemetryProperties,
	TelemetryValue,
	ToolPolicy,
} from "@clinebot/shared";
export {
	normalizeUserInput,
	RPC_TEAM_LIFECYCLE_EVENT_TYPE,
	RPC_TEAM_PROGRESS_EVENT_TYPE,
	resolveHookLogPath,
} from "@clinebot/shared";
export {
	ensureHookLogDir,
	ensureParentDir,
	resolveClineDataDir,
	resolveClineDir,
	resolveSessionDataDir,
	setClineDir,
	setClineDirIfUnset,
	setHomeDir,
	setHomeDirIfUnset,
} from "@clinebot/shared/storage";
export {
	type ClineAccountBalance,
	type ClineAccountOperations,
	type ClineAccountOrganization,
	type ClineAccountOrganizationBalance,
	type ClineAccountOrganizationUsageTransaction,
	type ClineAccountPaymentTransaction,
	ClineAccountService,
	type ClineAccountServiceOptions,
	type ClineAccountUsageTransaction,
	type ClineAccountUser,
	type ClineOrganization,
	executeRpcClineAccountAction,
	isRpcClineAccountActionRequest,
	RpcClineAccountService,
	type RpcProviderActionExecutor,
} from "./account";
export type {
	ChatMessage,
	ChatSessionConfig,
	ChatSessionStatus,
	ChatSummary,
	ChatViewState,
} from "./chat/chat-schema";
export {
	ChatMessageRoleSchema,
	ChatMessageSchema,
	ChatSessionConfigSchema,
	ChatSessionStatusSchema,
	ChatSummarySchema,
	ChatViewStateSchema,
} from "./chat/chat-schema";
export {
	hasMcpSettingsFile,
	InMemoryMcpManager,
	type LoadMcpSettingsOptions,
	loadMcpSettingsFile,
	type McpConnectionStatus,
	type McpManager,
	type McpManagerOptions,
	type McpServerClient,
	type McpServerClientFactory,
	type McpServerRegistration,
	type McpServerSnapshot,
	type McpServerTransportConfig,
	type McpSettingsFile,
	type McpSseTransportConfig,
	type McpStdioTransportConfig,
	type McpStreamableHttpTransportConfig,
	type RegisterMcpServersFromSettingsOptions,
	registerMcpServersFromSettingsFile,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
} from "./mcp";
export { ProviderSettingsManager } from "./storage/provider-settings-manager";
export {
	SqliteTeamStore,
	type SqliteTeamStoreOptions,
} from "./storage/team-store";
export {
	buildTeamProgressSummary,
	toTeamProgressLifecycleEvent,
} from "./team";
export type {
	TelemetryAgentIdentityProperties,
	TelemetryAgentKind,
} from "./telemetry/core-events";
export {
	CORE_TELEMETRY_EVENTS,
	captureAgentCreated,
	captureAgentTeamCreated,
	captureAuthFailed,
	captureAuthLoggedOut,
	captureAuthStarted,
	captureAuthSucceeded,
	captureConversationTurnEvent,
	captureDiffEditFailure,
	captureHookDiscovery,
	captureMentionFailed,
	captureMentionSearchResults,
	captureMentionUsed,
	captureModeSwitch,
	captureProviderApiError,
	captureSkillUsed,
	captureSubagentExecution,
	captureTaskCompleted,
	captureTaskCreated,
	captureTaskRestarted,
	captureTokenUsage,
	captureToolUsage,
	identifyAccount,
} from "./telemetry/core-events";
export type { ITelemetryAdapter } from "./telemetry/ITelemetryAdapter";
export {
	LoggerTelemetryAdapter,
	type LoggerTelemetryAdapterOptions,
} from "./telemetry/LoggerTelemetryAdapter";
export {
	TelemetryService,
	type TelemetryServiceOptions,
} from "./telemetry/TelemetryService";
export {
	ALL_DEFAULT_TOOL_NAMES,
	type AskQuestionExecutor,
	type CreateBuiltinToolsOptions,
	type CreateDefaultToolsOptions,
	createBuiltinTools,
	createDefaultExecutors,
	createDefaultTools,
	createDefaultToolsWithPreset,
	createToolPoliciesWithPreset,
	type DefaultExecutorsOptions,
	type DefaultToolName,
	DefaultToolNames,
	type DefaultToolsConfig,
	type ToolExecutors,
	type ToolPolicyPresetName,
	type ToolPresetName,
	ToolPresets,
} from "./tools";
// Compatibility barrel (legacy imports).
export type { RuntimeEnvironment, SessionEvent, StoredMessages } from "./types";
export type { SessionStatus } from "./types/common";
export { SESSION_STATUSES, SessionSource } from "./types/common";
export type {
	CoreAgentMode,
	CoreModelConfig,
	CoreRuntimeFeatures,
	CoreSessionConfig,
} from "./types/config";
export type {
	CoreSessionEvent,
	SessionChunkEvent,
	SessionEndedEvent,
	SessionTeamProgressEvent,
	SessionToolEvent,
} from "./types/events";
export type {
	ProviderTokenSource,
	StoredProviderSettings,
	StoredProviderSettingsEntry,
} from "./types/provider-settings";
export {
	emptyStoredProviderSettings,
	StoredProviderSettingsEntrySchema,
	StoredProviderSettingsSchema,
} from "./types/provider-settings";
export type { SessionRecord, SessionRef } from "./types/sessions";
export type { ArtifactStore, SessionStore, TeamStore } from "./types/storage";
export type { WorkspaceInfo } from "./types/workspace";
