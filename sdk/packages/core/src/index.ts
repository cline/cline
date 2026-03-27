/**
 * @clinebot/core
 *
 * Core contracts, shared state utilities, and Node runtime services.
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
export * from "@clinebot/shared/storage";
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
	type UserRemoteConfigResponse,
} from "./account";
export type {
	AgentConfigWatcher,
	AgentConfigWatcherEvent,
	AgentYamlConfig,
	BuildAgentConfigOverridesOptions,
	CreateAgentConfigWatcherOptions,
	CreateInstructionWatcherOptions,
	CreateRulesConfigDefinitionOptions,
	CreateSkillsConfigDefinitionOptions,
	CreateUserInstructionConfigWatcherOptions,
	CreateWorkflowsConfigDefinitionOptions,
	HookConfigFileEntry,
	LoadAgentPluginFromPathOptions,
	ParseMarkdownFrontmatterResult,
	ParseYamlFrontmatterResult,
	ResolveAgentPluginPathsOptions,
	RuleConfig,
	SkillConfig,
	UnifiedConfigDefinition,
	UnifiedConfigFileCandidate,
	UnifiedConfigFileContext,
	UnifiedConfigRecord,
	UnifiedConfigWatcherEvent,
	UnifiedConfigWatcherOptions,
	UserInstructionConfig,
	UserInstructionConfigType,
	UserInstructionConfigWatcher,
	UserInstructionConfigWatcherEvent,
	WorkflowConfig,
} from "./agents";
export {
	createAgentConfigDefinition,
	createAgentConfigWatcher,
	createRulesConfigDefinition,
	createSkillsConfigDefinition,
	createUserInstructionConfigWatcher,
	createWorkflowsConfigDefinition,
	discoverPluginModulePaths,
	HOOK_CONFIG_FILE_EVENT_MAP,
	HOOKS_CONFIG_DIRECTORY_NAME,
	HookConfigFileName,
	listHookConfigFiles,
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
	parseAgentConfigFromYaml,
	parsePartialAgentConfigFromYaml,
	parseRuleConfigFromMarkdown,
	parseSkillConfigFromMarkdown,
	parseWorkflowConfigFromMarkdown,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentPluginPaths,
	resolveAgentTools,
	resolveAndLoadAgentPlugins,
	resolveDocumentsHooksDirectoryPath,
	resolveDocumentsRulesDirectoryPath,
	resolveDocumentsWorkflowsDirectoryPath,
	resolveHooksConfigSearchPaths,
	resolvePluginConfigSearchPaths,
	resolveRulesConfigSearchPaths,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	SKILLS_CONFIG_DIRECTORY_NAME,
	toHookConfigFileName,
	toPartialAgentConfig,
	UnifiedConfigFileWatcher,
	WORKFLOWS_CONFIG_DIRECTORY_NAME,
} from "./agents";
export {
	createOAuthClientCallbacks,
	type OAuthClientCallbacksOptions,
} from "./auth/client";
export {
	createClineOAuthProvider,
	getValidClineCredentials,
	loginClineOAuth,
	refreshClineToken,
} from "./auth/cline";
export {
	getValidOpenAICodexCredentials,
	isOpenAICodexTokenExpired,
	loginOpenAICodex,
	normalizeOpenAICodexCredentials,
	openaiCodexOAuthProvider,
	refreshOpenAICodexToken,
} from "./auth/codex";
export {
	createOcaOAuthProvider,
	createOcaRequestHeaders,
	DEFAULT_EXTERNAL_IDCS_CLIENT_ID,
	DEFAULT_EXTERNAL_IDCS_SCOPES,
	DEFAULT_EXTERNAL_IDCS_URL,
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_IDCS_CLIENT_ID,
	DEFAULT_INTERNAL_IDCS_SCOPES,
	DEFAULT_INTERNAL_IDCS_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
	generateOcaOpcRequestId,
	getValidOcaCredentials,
	loginOcaOAuth,
	OCI_HEADER_OPC_REQUEST_ID,
	refreshOcaToken,
} from "./auth/oca";
export { startLocalOAuthServer } from "./auth/server";
export type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthProviderInterface,
	OcaClientMetadata,
	OcaMode,
	OcaOAuthConfig,
	OcaOAuthEnvironmentConfig,
	OcaOAuthProviderOptions,
	OcaTokenResolution,
} from "./auth/types";
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
export type {
	FastFileIndexOptions,
	MentionEnricherOptions,
	MentionEnrichmentResult,
} from "./input";
export {
	enrichPromptWithMentions,
	getFileIndex,
	prewarmFileIndex,
} from "./input";
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
export {
	addLocalProvider,
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	listLocalProviders,
	loginLocalProvider,
	normalizeOAuthProvider,
	resolveLocalClineAuthToken,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
} from "./providers/local-provider-service";
export type { AvailableRuntimeCommand } from "./runtime/commands";
export {
	listAvailableRuntimeCommandsFromWatcher,
	resolveRuntimeSlashCommandFromWatcher,
} from "./runtime/commands";
export {
	formatRulesForSystemPrompt,
	isRuleEnabled,
	listEnabledRulesFromWatcher,
	loadRulesForSystemPromptFromWatcher,
} from "./runtime/rules";
export {
	createTeamName,
	DefaultRuntimeBuilder,
} from "./runtime/runtime-builder";
export {
	type SandboxCallOptions,
	SubprocessSandbox,
	type SubprocessSandboxOptions,
} from "./runtime/sandbox/subprocess-sandbox";
export type {
	BuiltRuntime,
	RuntimeBuilder,
	RuntimeBuilderInput,
	SessionRuntime,
} from "./runtime/session-runtime";
export type { AvailableSkill } from "./runtime/skills";
export {
	listAvailableSkillsFromWatcher,
	resolveSkillsSlashCommandFromWatcher,
} from "./runtime/skills";
export {
	type DesktopToolApprovalOptions,
	requestDesktopToolApproval,
} from "./runtime/tool-approval";
export type { AvailableWorkflow } from "./runtime/workflows";
export {
	listAvailableWorkflowsFromWatcher,
	resolveWorkflowSlashCommandFromWatcher,
} from "./runtime/workflows";
export { DefaultSessionManager } from "./session/default-session-manager";
export { RpcCoreSessionService } from "./session/rpc-session-service";
export {
	type RpcSpawnLease,
	tryAcquireRpcSpawnLease,
} from "./session/rpc-spawn-lease";
export {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
	sanitizeSessionToken,
} from "./session/session-graph";
export type {
	CreateSessionHostOptions,
	SessionBackend,
	SessionHost,
} from "./session/session-host";
export {
	createSessionHost,
	resolveSessionBackend,
} from "./session/session-host";
export type {
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionManager,
	StartSessionInput,
	StartSessionResult,
} from "./session/session-manager";
export type { SessionManifest } from "./session/session-manifest";
export type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
} from "./session/session-service";
export { CoreSessionService } from "./session/session-service";
export {
	createSqliteRpcSessionBackend,
	SqliteRpcSessionBackend,
	type SqliteRpcSessionBackendOptions,
} from "./session/sqlite-rpc-session-backend";
export {
	accumulateUsageTotals,
	createInitialAccumulatedUsage,
} from "./session/utils/usage";
export type {
	WorkspaceManager,
	WorkspaceManagerEvent,
} from "./session/workspace-manager";
export { InMemoryWorkspaceManager } from "./session/workspace-manager";
export type { WorkspaceManifest } from "./session/workspace-manifest";
export {
	buildWorkspaceMetadata,
	emptyWorkspaceManifest,
	generateWorkspaceInfo,
	normalizeWorkspacePath,
	upsertWorkspaceInfo,
	WorkspaceInfoSchema,
	WorkspaceManifestSchema,
} from "./session/workspace-manifest";
export {
	type MigrateLegacyProviderSettingsOptions,
	type MigrateLegacyProviderSettingsResult,
	migrateLegacyProviderSettings,
} from "./storage/provider-settings-legacy-migration";
export { ProviderSettingsManager } from "./storage/provider-settings-manager";
export { SqliteSessionStore } from "./storage/sqlite-session-store";
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
export async function loadOpenTelemetryAdapter() {
	return import("./telemetry/index.js");
}
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
