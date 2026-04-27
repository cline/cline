/**
 * @clinebot/core
 *
 * Core contracts, shared state utilities, and Node runtime services.
 */

export * as Llms from "@clinebot/llms";
// Shared contracts and path helpers re-exported for app consumers.
export type {
	AddProviderActionRequest,
	AgentConfig,
	AgentEvent,
	AgentExtension,
	AgentExtension as AgentPlugin, // Public-facing alias for extensions
	AgentExtensionCommand,
	AgentExtensionCommand as AgentPluginCommand,
	AgentHooks,
	AgentMode,
	AgentResult,
	AgentRunResult,
	AgentRunStatus,
	BasicLogger,
	ChatRunTurnRequest,
	ChatRuntimeConfig,
	ChatStartSessionArtifacts,
	ChatStartSessionRequest,
	ChatTurnResult,
	ClineAccountActionRequest,
	ConnectorHookEvent,
	EnterpriseAuthenticateRequest,
	EnterpriseAuthenticateResponse,
	EnterpriseStatusRequest,
	EnterpriseStatusResponse,
	EnterpriseSyncRequest,
	EnterpriseSyncResponse,
	emptyWorkspaceManifest,
	GetProviderModelsActionRequest,
	HookSessionContext,
	ITelemetryService,
	ListProvidersActionRequest,
	MessageWithMetadata,
	OAuthProviderId,
	ProviderActionRequest,
	ProviderCatalogResponse,
	ProviderListItem,
	ProviderModel,
	ProviderOAuthLoginResponse,
	RuntimeLoggerConfig,
	SaveProviderSettingsActionRequest,
	SessionLineage,
	TEAM_LIFECYCLE_EVENT_TYPE,
	TEAM_PROGRESS_EVENT_TYPE,
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
	buildClineSystemPrompt as getClineDefaultSystemPrompt,
	ContributionRegistry,
	createContributionRegistry,
	createTool,
	formatDisplayUserInput,
	noopBasicLogger,
	normalizeUserInput,
	parseUserCommandEnvelope,
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
	executeClineAccountAction,
	type FeaturebaseTokenResponse,
	isClineAccountActionRequest,
	type ProviderActionExecutor,
	RpcClineAccountService,
	type UserRemoteConfigOrganization,
	type UserRemoteConfigResponse,
} from "./account";
export {
	createOAuthClientCallbacks,
	type OAuthClientCallbacksOptions,
} from "./auth/client";
export {
	completeClineDeviceAuth,
	createClineOAuthProvider,
	getValidClineCredentials,
	loginClineOAuth,
	refreshClineToken,
	startClineDeviceAuth,
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
export type {
	LocalOAuthServer,
	LocalOAuthServerOptions,
	OAuthCallbackPayload,
	OAuthServerCloseInfo,
	OAuthServerListeningInfo,
} from "./auth/server";
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
	type ClineCoreStartInput,
	type HubOptions,
	type RemoteOptions,
} from "./ClineCore";
export * from "./cron";
export type {
	LoadAgentPluginFromPathOptions,
	PluginInitializationFailure,
	PluginInitializationWarning,
	PluginLoadDiagnostics,
	ResolveAgentPluginPathsOptions,
} from "./extensions";
export {
	discoverPluginModulePaths,
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
	loadAgentPluginsFromPathsWithDiagnostics,
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
	createDefaultMcpServerClientFactory,
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
	reviveTeamStateDates,
	type SpawnTeammateOptions,
	type SubAgentEndContext,
	type SubAgentStartContext,
	sanitizeTeamName,
	type TaskResult,
	type TeamEvent,
	type TeamMemberConfig,
	type TeamTeammateRuntimeConfig,
	toTeamProgressLifecycleEvent,
} from "./extensions/tools/team";
export {
	createSubprocessHooks,
	type HookEventName,
	HookEventNameSchema,
	type HookEventPayload,
	HookEventPayloadSchema,
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
	CheckpointEntry,
	CheckpointMetadata,
} from "./hooks/checkpoint-hooks";
export * from "./hub";
export type { SessionBackend } from "./runtime/host";
export {
	createRuntimeHost,
	createRuntimeHost as createSessionHost,
	resolveSessionBackend,
} from "./runtime/host";
export {
	formatRulesForSystemPrompt,
	isRuleEnabled,
	listEnabledRulesFromWatcher,
	loadRulesForSystemPromptFromWatcher,
	mergeRulesForSystemPrompt,
} from "./runtime/rules";
export {
	createTeamName,
	DefaultRuntimeBuilder,
} from "./runtime/runtime-builder";
export type {
	PendingPromptMutationResult,
	PendingPromptsAction,
	PendingPromptsDeleteInput,
	PendingPromptsListInput,
	PendingPromptsUpdateInput,
	RuntimeHost,
	RuntimeHost as SessionHost,
	RuntimeHostMode,
	RuntimeHostSubscribeOptions,
	SendSessionInput,
	SessionAccumulatedUsage,
	StartSessionInput,
	StartSessionResult,
} from "./runtime/runtime-host";
export { splitCoreSessionConfig } from "./runtime/runtime-host";
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
export type { GlobalSettings } from "./services/global-settings";
export {
	filterDisabledTools,
	filterExtensionToolRegistrations,
	isToolDisabledGlobally,
	readGlobalSettings,
	resolveDisabledToolNames,
	toggleDisabledTool,
	writeGlobalSettings,
} from "./services/global-settings";
export type { PluginToolSummary } from "./services/plugin-tools";
export { listPluginTools } from "./services/plugin-tools";
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
} from "./services/providers/local-provider-service";
export {
	type MigrateLegacyProviderSettingsOptions,
	type MigrateLegacyProviderSettingsResult,
	migrateLegacyProviderSettings,
} from "./services/storage/provider-settings-legacy-migration";
export { ProviderSettingsManager } from "./services/storage/provider-settings-manager";
export { SqliteSessionStore } from "./services/storage/sqlite-session-store";
export {
	SqliteTeamStore,
	type SqliteTeamStoreOptions,
} from "./services/storage/team-store";
export type {
	TelemetryAgentIdentityProperties,
	TelemetryAgentKind,
} from "./services/telemetry/core-events";
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
} from "./services/telemetry/core-events";
export type { ITelemetryAdapter } from "./services/telemetry/ITelemetryAdapter";
export {
	type CreateOpenTelemetryTelemetryServiceOptions,
	createConfiguredTelemetryService,
	createOpenTelemetryTelemetryService,
	OpenTelemetryProvider,
	type OpenTelemetryProviderOptions,
} from "./services/telemetry/OpenTelemetryProvider";
export {
	TelemetryLoggerSink,
	type TelemetryLoggerSinkOptions,
} from "./services/telemetry/TelemetryLoggerSink";
export {
	accumulateUsageTotals,
	createInitialAccumulatedUsage,
} from "./services/usage";
export type {
	FastFileIndexOptions,
	MentionEnricherOptions,
	MentionEnrichmentResult,
} from "./services/workspace";
export {
	enrichPromptWithMentions,
	getFileIndex,
	prewarmFileIndex,
} from "./services/workspace";
export {
	buildWorkspaceMetadata,
	generateWorkspaceInfo,
	normalizeWorkspacePath,
} from "./services/workspace-manifest";
export {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
	sanitizeSessionToken,
} from "./session/session-graph";
export type { SessionManifest } from "./session/session-manifest";
export type { SessionRow } from "./session/session-row";
export type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
} from "./session/session-service";
export { CoreSessionService } from "./session/session-service";
export {
	FileTeamPersistenceStore,
	type FileTeamPersistenceStoreOptions,
} from "./session/team-persistence-store";
export type {
	WorkspaceManager,
	WorkspaceManagerEvent,
} from "./session/workspace-manager";
export { InMemoryWorkspaceManager } from "./session/workspace-manager";
export { HubRuntimeHost } from "./transports/hub";
export { LocalRuntimeHost } from "./transports/local";
export { RemoteRuntimeHost } from "./transports/remote";
export type {
	ChatMessage,
	ChatSessionConfig,
	ChatSessionStatus,
	ChatSummary,
	ChatViewState,
} from "./types/chat-schema";
export {
	ChatMessageRoleSchema,
	ChatMessageSchema,
	ChatSessionConfigSchema,
	ChatSessionStatusSchema,
	ChatSummarySchema,
	ChatViewStateSchema,
} from "./types/chat-schema";
export type { SessionMessagesArtifactUploader } from "./types/session";
export { CORE_BUILD_VERSION } from "./version";
export async function loadOpenTelemetryAdapter() {
	return import("./services/telemetry/index.js");
}
export { Agent, createAgentRuntime } from "@clinebot/agents";
export { createContextCompactionPrepareTurn } from "./extensions/context/compaction";
export {
	ALL_DEFAULT_TOOL_NAMES,
	type AskQuestionExecutor,
	type BuiltinToolAvailabilityContext,
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
	getCoreAcpToolNames,
	getCoreBuiltinToolCatalog,
	getCoreDefaultEnabledToolIds,
	getCoreHeadlessToolNames,
	resolveCoreSelectedToolIds,
	TEAM_TOOL_NAMES,
	type ToolCatalogEntry,
	type ToolExecutors,
	type ToolPolicyPresetName,
	type ToolPresetName,
	ToolPresets,
} from "./extensions/tools";
export {
	clearLiveModelsCatalogCache,
	clearPrivateModelsCatalogCache,
	DEFAULT_MODELS_CATALOG_URL,
	getLiveModelsCatalog,
	getProviderConfig,
	OPENAI_COMPATIBLE_PROVIDERS,
	resolveProviderConfig,
} from "./llms/provider-defaults";
export type {
	AuthSettings,
	AwsSettings,
	AzureSettings,
	BuiltInProviderId,
	GcpSettings,
	ModelCatalogConfig,
	ModelCatalogSettings,
	OcaSettings,
	ProviderCapability,
	ProviderClient,
	ProviderConfig,
	ProviderDefaultsConfig,
	ProviderId,
	ProviderProtocol,
	ProviderSettings,
	ReasoningSettings,
	SapSettings,
} from "./llms/provider-settings";
export {
	AuthSettingsSchema,
	AwsSettingsSchema,
	AzureSettingsSchema,
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	createProviderConfig,
	GcpSettingsSchema,
	isBuiltInProviderId,
	ModelCatalogSettingsSchema,
	normalizeProviderId,
	OcaSettingsSchema,
	ProviderClientSchema,
	ProviderIdSchema,
	ProviderProtocolSchema,
	ProviderSettingsSchema,
	parseSettings,
	ReasoningSettingsSchema,
	SapSettingsSchema,
	safeCreateProviderConfig,
	safeParseSettings,
	toProviderConfig,
} from "./llms/provider-settings";
export {
	defineLlmsConfig,
	loadLlmsConfigFromFile,
} from "./llms/runtime-config";
export { createLlmsSdk, DefaultLlmsSdk } from "./llms/runtime-registry";
export type {
	BuiltInProviderSummary,
	CreateHandlerInput,
	LlmsConfig,
	LlmsSdk,
	ProviderConfigDefaults,
	ProviderSelectionConfig,
	RegisterBuiltinProviderInput,
	RegisteredProviderSummary,
	RegisterModelInput,
	RegisterProviderInput,
} from "./llms/runtime-types";
export {
	TelemetryService,
	type TelemetryServiceOptions,
} from "./services/telemetry/TelemetryService";
// Compatibility barrel (legacy imports).
export type { RuntimeEnvironment } from "./types";
export type { SessionStatus } from "./types/common";
export { SESSION_STATUSES, SessionSource } from "./types/common";
export type {
	CoreAgentMode,
	CoreCheckpointConfig,
	CoreCheckpointContext,
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
	SessionPendingPrompt,
	SessionPendingPromptSubmittedEvent,
	SessionPendingPromptsEvent,
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
export type {
	SessionHistoryMetadata,
	SessionHistoryRecord,
	SessionRecord,
	SessionRef,
} from "./types/sessions";
export type { ArtifactStore, SessionStore, TeamStore } from "./types/storage";
