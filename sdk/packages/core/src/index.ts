/**
 * @clinebot/core
 *
 * Core contracts, shared state utilities, and Node runtime services.
 */

export type {
	AgentConfig,
	AgentEvent,
	AgentExtension,
	AgentExtensionCommand,
	AgentHooks,
	AgentResult,
} from "@clinebot/agents";
export {
	ContributionRegistry,
	createContributionRegistry,
} from "@clinebot/agents";
export * as Llms from "@clinebot/llms";
// Shared contracts and path helpers re-exported for app consumers.
export type {
	AgentMode,
	BasicLogger,
	ConnectorHookEvent,
	emptyWorkspaceManifest,
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
	RpcEnterpriseAuthenticateRequest,
	RpcEnterpriseAuthenticateResponse,
	RpcEnterpriseStatusRequest,
	RpcEnterpriseStatusResponse,
	RpcEnterpriseSyncRequest,
	RpcEnterpriseSyncResponse,
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
	Tool,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolContext,
	ToolPolicy,
	WorkspaceInfo,
	WorkspaceInfoSchema,
	WorkspaceManifest,
	WorkspaceManifestSchema,
} from "@clinebot/shared";
export {
	createTool,
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
	type FeaturebaseTokenResponse,
	isRpcClineAccountActionRequest,
	RpcClineAccountService,
	type RpcProviderActionExecutor,
	type UserRemoteConfigResponse,
} from "./account";
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
export {
	ClineCore,
	type ClineCoreOptions,
	type RpcOptions,
} from "./ClineCore";
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
	LoadAgentPluginFromPathOptions,
	ResolveAgentPluginPathsOptions,
} from "./extensions";
export {
	discoverPluginModulePaths,
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
	resolveAgentPluginPaths,
	resolveAndLoadAgentPlugins,
	resolvePluginConfigSearchPaths,
} from "./extensions";
export type {
	AgentConfigWatcher,
	AgentConfigWatcherEvent,
	AgentYamlConfig,
	AvailableRuntimeCommand,
	BuildAgentConfigOverridesOptions,
	CreateAgentConfigWatcherOptions,
	CreateInstructionWatcherOptions,
	CreateRulesConfigDefinitionOptions,
	CreateSkillsConfigDefinitionOptions,
	CreateUserInstructionConfigWatcherOptions,
	CreateWorkflowsConfigDefinitionOptions,
	HookConfigFileEntry,
	ParseMarkdownFrontmatterResult,
	ParseYamlFrontmatterResult,
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
} from "./extensions/config";
export {
	createAgentConfigDefinition,
	createAgentConfigWatcher,
	createRulesConfigDefinition,
	createSkillsConfigDefinition,
	createUserInstructionConfigWatcher,
	createWorkflowsConfigDefinition,
	HOOK_CONFIG_FILE_EVENT_MAP,
	HOOKS_CONFIG_DIRECTORY_NAME,
	HookConfigFileName,
	listAvailableRuntimeCommandsFromWatcher,
	listHookConfigFiles,
	parseAgentConfigFromYaml,
	parsePartialAgentConfigFromYaml,
	parseRuleConfigFromMarkdown,
	parseSkillConfigFromMarkdown,
	parseWorkflowConfigFromMarkdown,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentTools,
	resolveDocumentsHooksDirectoryPath,
	resolveDocumentsRulesDirectoryPath,
	resolveDocumentsWorkflowsDirectoryPath,
	resolveHooksConfigSearchPaths,
	resolveRulesConfigSearchPaths,
	resolveRuntimeSlashCommandFromWatcher,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	SKILLS_CONFIG_DIRECTORY_NAME,
	toHookConfigFileName,
	toPartialAgentConfig,
	UnifiedConfigFileWatcher,
	WORKFLOWS_CONFIG_DIRECTORY_NAME,
} from "./extensions/config";
export {
	type CreateDisabledMcpToolPoliciesOptions,
	type CreateDisabledMcpToolPolicyOptions,
	type CreateMcpToolsOptions,
	createDisabledMcpToolPolicies,
	createDisabledMcpToolPolicy,
	createMcpTools,
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
	type McpToolCallRequest,
	type McpToolCallResult,
	type McpToolDescriptor,
	type McpToolNameTransform,
	type McpToolProvider,
	type RegisterMcpServersFromSettingsOptions,
	registerMcpServersFromSettingsFile,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
} from "./extensions/mcp";
export {
	createPersistentSubprocessHooks,
	createSubprocessHooks,
	type HookEventName,
	HookEventNameSchema,
	type HookEventPayload,
	HookEventPayloadSchema,
	PersistentHookClient,
	type PersistentHookClientOptions,
	type PersistentSubprocessHookControl,
	type PersistentSubprocessHooksOptions,
	parseHookEventPayload,
	type RunHookOptions,
	type RunHookResult,
	type RunSubprocessEventOptions,
	type RunSubprocessEventResult,
	runHook,
	runSubprocessEvent,
	type SubprocessHookControl,
	type SubprocessHooksOptions,
} from "./hooks";
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
export { getClineDefaultSystemPrompt } from "./prompt/default-system";
export {
	addLocalProvider,
	type DeleteLocalProviderRequest,
	deleteLocalProvider,
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	listLocalProviders,
	loginLocalProvider,
	normalizeOAuthProvider,
	resolveLocalClineAuthToken,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	type UpdateLocalProviderRequest,
	updateLocalProvider,
} from "./providers/local-provider-service";
export type {
	CheckpointEntry,
	CheckpointMetadata,
} from "./runtime/checkpoint-hooks";
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
export type {
	BuiltRuntime,
	RuntimeBuilder,
	RuntimeBuilderInput,
	SessionRuntime,
} from "./runtime/session-runtime";
export {
	type SandboxCallOptions,
	SubprocessSandbox,
	type SubprocessSandboxOptions,
} from "./runtime/subprocess-sandbox";
export {
	type DesktopToolApprovalOptions,
	requestDesktopToolApproval,
} from "./runtime/tool-approval";
export { DefaultSessionManager } from "./session/default-session-manager";
export {
	clearRpcDiscoveryIfAddressMatches,
	type EnsureRpcRuntimeOptions,
	ensureRpcRuntimeAddress,
	isCompatibleRuntime,
	type ResolveRpcRuntimeResult,
	RPC_BUILD_ID_ENV,
	RPC_DISCOVERY_PATH_ENV,
	RPC_OWNER_ID_ENV,
	RPC_STARTUP_LOCK_BYPASS_ENV,
	type RpcDiscoveryRecord,
	type RpcOwnerContext,
	recordRpcDiscovery,
	resolveEnsuredRpcRuntime,
	resolveRpcOwnerContext,
	resolveRpcRuntimeBuildKey,
	waitForCompatibleRpcRuntime,
	withRpcStartupLock,
} from "./session/rpc-runtime-ensure";
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
export {
	buildWorkspaceMetadata,
	generateWorkspaceInfo,
	normalizeWorkspacePath,
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
	type AgentTask,
	AgentTeam,
	AgentTeamsRuntime,
	type AgentTeamsRuntimeOptions,
	type BootstrapAgentTeamsOptions,
	type BootstrapAgentTeamsResult,
	bootstrapAgentTeams,
	buildDelegatedAgentConfig,
	buildTeamProgressSummary,
	type CreateAgentTeamsToolsOptions,
	createAgentTeamsTools,
	createDelegatedAgent,
	createDelegatedAgentConfigProvider,
	createSpawnAgentTool,
	type DelegatedAgentConfigProvider,
	type DelegatedAgentConnectionConfig,
	type DelegatedAgentKind,
	type DelegatedAgentRuntimeConfig,
	type MissionLogEntry,
	type MissionLogKind,
	type SubAgentEndContext,
	type SubAgentStartContext,
	type TaskResult,
	type TeamEvent,
	type TeamMailboxMessage,
	type TeamMemberConfig,
	type TeamMemberSnapshot,
	TeamMessageType,
	type TeammateLifecycleSpec,
	type TeamOutcome,
	type TeamOutcomeFragment,
	type TeamOutcomeFragmentStatus,
	type TeamOutcomeStatus,
	type TeamRunRecord,
	type TeamRunStatus,
	type TeamRuntimeSnapshot,
	type TeamRuntimeState,
	type TeamTask,
	type TeamTaskStatus,
	type TeamTeammateRuntimeConfig,
	type TeamTeammateSpec,
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
	type CreateOpenTelemetryTelemetryServiceOptions,
	createConfiguredTelemetryService,
	createOpenTelemetryTelemetryService,
	OpenTelemetryProvider,
	type OpenTelemetryProviderOptions,
} from "./telemetry/OpenTelemetryProvider";
export { CORE_BUILD_VERSION } from "./version";
export async function loadOpenTelemetryAdapter() {
	return import("./telemetry/index.js");
}
export { createContextCompactionPrepareTurn } from "./extensions/context/compaction";
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
export type { RuntimeEnvironment } from "./types";
export type { SessionStatus } from "./types/common";
export { SESSION_STATUSES, SessionSource } from "./types/common";
export type {
	CoreAgentMode,
	CoreCompactionConfig,
	CoreCompactionContext,
	CoreCompactionResult,
	CoreCompactionStrategy,
	CoreCompactionSummarizerConfig,
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
