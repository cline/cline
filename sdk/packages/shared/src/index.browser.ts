export * from "./agent";
export * from "./agents";
export type {
	ConnectorAuthorizationDecision,
	ConnectorAuthorizationRequest,
	ConnectorEventActor,
	ConnectorEventContext,
	ConnectorHookEvent,
	ConnectorHookEventName,
} from "./connectors/events";
export {
	ConnectorAuthorizationDecisionSchema,
	ConnectorAuthorizationRequestSchema,
	ConnectorEventActorSchema,
	ConnectorEventContextSchema,
	ConnectorHookEventNameSchema,
	ConnectorHookEventSchema,
} from "./connectors/events";
export type * from "./connectors/options";
export type {
	ActiveConnectorRecord,
	ConfiguredConnectorRecord,
	ConnectorCatalogEntry,
	ConnectorChannel,
	ConnectorChannelsResponse,
	ConnectorFieldCondition,
	ConnectorFieldDef,
	ConnectorPlatformDef,
	ConnectorSecurityDef,
	ConnectorSecurityFieldDef,
} from "./connectors/platforms";
export {
	CONNECTOR_CATALOG,
	CONNECTOR_PLATFORMS,
	connectorChannelsFromPlatforms,
	listConnectorCatalog,
	shouldIncludeConnectorField,
} from "./connectors/platforms";
export type { AutomationEventEnvelope } from "./cron";
export type {
	ClientContext,
	ClientName,
	ExtensionContext,
	UserContext,
	WorkspaceContext,
} from "./extensions/context";
export type {
	AgentExtensionApi,
	AgentExtensionAutomationContext,
	AgentExtensionAutomationEventType,
	AgentExtensionCapability,
	AgentExtensionCommand,
	AgentExtensionCommandResult,
	AgentExtensionHooks,
	AgentExtensionMcpEnv,
	AgentExtensionMcpEnvValue,
	AgentExtensionMcpServer,
	AgentExtensionMcpSseTransport,
	AgentExtensionMcpStdioTransport,
	AgentExtensionMcpStreamableHttpTransport,
	AgentExtensionMcpTransport,
	AgentExtensionMessageBuilder,
	AgentExtensionProvider,
	AgentExtensionRegistry,
	AgentExtensionRule,
	AgentExtensionSessionContext,
	ContributionRegistryExtension,
	ContributionRegistryOptions,
	PluginManifest,
	PluginSetupContext,
} from "./extensions/contribution-registry";
export {
	ContributionRegistry,
	createContributionRegistry,
	normalizePluginManifest,
} from "./extensions/contribution-registry";
export { PLUGIN_FILE_EXTENSIONS } from "./extensions/plugin";
export {
	FEATURE_FLAGS,
	type FeatureFlag,
	FeatureFlagDefaultValue,
	type FeatureFlagPayload,
	type FeatureFlagsAndPayloads,
	type FeatureFlagsContext,
	type FeatureFlagsSettings,
	type IFeatureFlagsProvider,
} from "./feature-flags";
export type { HookControl } from "./hooks/contracts";
export type {
	AgentAbortHookPayload,
	AgentEndHookPayload,
	AgentErrorHookPayload,
	AgentResumeHookPayload,
	AgentStartHookPayload,
	HookEventName,
	HookEventPayload,
	HookEventPayloadBase,
	PostToolUseData,
	PreCompactData,
	PreCompactHookPayload,
	PreToolUseData,
	PromptSubmitHookPayload,
	SessionShutdownHookPayload,
	TaskCancelData,
	TaskCompleteData,
	TaskResumeData,
	TaskStartData,
	ToolCallHookPayload,
	ToolResultHookPayload,
	UserPromptSubmitData,
} from "./hooks/events";
export {
	HookEventNameSchema,
	HookEventPayloadSchema,
	parseHookEventPayload,
} from "./hooks/events";
export * from "./hub";
export type {
	AiSdkFormatterMessage,
	AiSdkFormatterMessageRole,
	AiSdkFormatterPart,
	AiSdkMessage,
	AiSdkMessagePart,
} from "./llms/ai-sdk-format";
export {
	EMPTY_CONTENT_TEXT,
	formatMessagesForAiSdk,
	sanitizeSurrogates,
	toAiSdkToolResultOutput,
} from "./llms/ai-sdk-format";
export * from "./llms/gateway";
export {
	createMediaBudgetState,
	DEFAULT_MAX_IMAGE_BASE64_BYTES,
	DEFAULT_MAX_IMAGE_DECODED_BYTES,
	DEFAULT_MAX_IMAGE_ENCODED_BYTES,
	DEFAULT_MAX_TOTAL_MEDIA_BYTES,
	IMAGE_OMITTED_PLACEHOLDER,
	type ImageMediaLimits,
	type ImageMediaValidationFailure,
	type ImageMediaValidationResult,
	type ImageMediaValidationSuccess,
	imageBase64DecodedByteLength,
	imageBase64EncodedByteLength,
	imageBase64LengthForDecodedBytes,
	imageFileMaxDecodedBytesForBase64Limit,
	isBase64Char,
	isCanonicalBase64,
	type MediaBudgetOptions,
	type MediaBudgetState,
	type ResolvedMediaBudget,
	reserveImageMediaBytes,
	resolveMediaBudget,
	SUPPORTED_IMAGE_MEDIA_TYPES,
	validateAndReserveImageMedia,
	validateImageMedia,
} from "./llms/media";
export type {
	ContentBlock,
	FileContent,
	ImageContent,
	Message,
	MessageRole,
	MessageWithMetadata,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolDefinition,
	ToolResultContent,
	ToolUseContent,
} from "./llms/messages";
export {
	ApiFormat,
	ApiFormatSchema,
	type ModelCapability,
	ModelCapabilitySchema,
	type ModelInfo,
	ModelInfoSchema,
	type ModelMetadata,
	ModelMetadataSchema,
	type ModelPricing,
	ModelPricingSchema,
	type ModelStatus,
	ModelStatusSchema,
	type ThinkingConfig,
	ThinkingConfigSchema,
} from "./llms/model-info";
export { mergeModelOptions } from "./llms/model-options";
export {
	DEFAULT_REASONING_EFFORT,
	REASONING_EFFORT_RATIOS,
	resolveEffectiveReasoningEffort,
	resolveReasoningBudgetFromRatio,
	resolveReasoningEffortRatio,
} from "./llms/reasoning-effort";
export {
	buildClineClientRequestHeaders,
	type ClineClientRequestHeadersInput,
	DEFAULT_REQUEST_HEADERS,
	type MergeClineClientRequestHeadersInput,
	mergeClineClientRequestHeaders,
	serializeAbortReason,
} from "./llms/requests";
export { CHARS_PER_TOKEN, estimateTokens } from "./llms/tokens";
export type {
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolCallRecord,
	ToolPolicy,
} from "./llms/tools";
export { ToolCallRecordSchema } from "./llms/tools";
export {
	type BasicLogger,
	type BasicLogMetadata,
	noopBasicLogger,
} from "./logging/logger";
export {
	normalizeJsonLikeStringsForSchema,
	parseJsonStream,
	safeJsonParse,
	safeJsonStringify,
} from "./parse/json";
export { type OmitUndefinedValues, omitUndefinedValues } from "./parse/object";
export { getDefaultShell, getShellArgs } from "./parse/shell";
export {
	maskSecret,
	sanitizeFileName,
	trimNonEmpty,
	truncateSplit,
	truncateStr,
} from "./parse/string";
export { formatHumanReadableDate, formatUptime } from "./parse/time";
export { validateWithZod, zodToJsonSchema } from "./parse/zod";
export type { ClineSystemPromptOptions } from "./prompt/cline";
export {
	buildClineSystemPrompt,
	MODE_TAG_INSTRUCTIONS,
	PLAN_MODE_INSTRUCTIONS,
} from "./prompt/cline";
export type {
	ModeSwitchNotice,
	ModeSwitchNoticeTracker,
} from "./prompt/format";
export {
	createModeSwitchNoticeTracker,
	formatDisplayUserInput,
	formatFileContentBlock,
	formatModeSwitchNotice,
	formatUserCommandBlock,
	formatUserInputBlock,
	normalizeUserInput,
	parseUserCommandEnvelope,
	stripModeNotices,
	xmlTagsRemoval,
} from "./prompt/format";
export { isClineProvider } from "./providers/utils";
export { REMOTE_URI_SCHEME } from "./remote-config/constants";
export type {
	AnthropicModel,
	AnthropicSettings,
	APIKeySettings,
	AwsBedrockCustomModel,
	AwsBedrockModel,
	AwsBedrockSettings,
	EnterpriseTelemetry,
	GlobalInstructionsFile,
	LiteLLMModel,
	LiteLLMSettings,
	MCPServer,
	OpenAiCompatible,
	OpenAiCompatibleModel,
	PromptUploading,
	ProviderSettings,
	RemoteConfig,
	RemoteMCPServer,
	S3AccessKeySettings,
	VertexModel,
	VertexSettings,
} from "./remote-config/schema";
export {
	AllowedMCPServerSchema,
	AnthropicModelSchema,
	AnthropicSchema,
	APIKeySchema,
	AwsBedrockCustomModelSchema,
	AwsBedrockModelSchema,
	AwsBedrockSettingsSchema,
	ClineModelSchema,
	ClineSettingsSchema,
	EnterpriseTelemetrySchema,
	GlobalInstructionsFileSchema,
	LiteLLMModelSchema,
	LiteLLMSchema,
	OpenAiCompatibleModelSchema,
	OpenAiCompatibleSchema,
	PromptUploadingSchema,
	RemoteConfigSchema,
	RemoteMCPServerSchema,
	S3AccessKeySettingsSchema,
	VertexModelSchema,
	VertexSettingsSchema,
} from "./remote-config/schema";
export { CLINE_DEFAULT_RPC_ADDRESS, CLINE_DEFAULT_RPC_PORT } from "./rpc";
export type {
	AddProviderActionRequest,
	ChatAttachmentFile,
	ChatAttachments,
	ChatRunTurnRequest,
	ChatRuntimeConfig,
	ChatStartSessionArtifacts,
	ChatStartSessionRequest,
	ChatStartSessionResponse,
	ChatToolCallResult,
	ChatTurnResult,
	ClineAccountActionRequest,
	EnterpriseAuthenticateRequest,
	EnterpriseAuthenticateResponse,
	EnterpriseStatusRequest,
	EnterpriseStatusResponse,
	EnterpriseSyncRequest,
	EnterpriseSyncResponse,
	GetProviderModelsActionRequest,
	ListProvidersActionRequest,
	ProviderActionRequest,
	ProviderCapability,
	ProviderCatalogResponse,
	ProviderClient,
	ProviderConfigField,
	ProviderConfigFieldOption,
	ProviderConfigFieldPrimitive,
	ProviderConfigFieldType,
	ProviderListItem,
	ProviderModel,
	ProviderModelsResponse,
	ProviderOAuthLoginResponse,
	ProviderProtocol,
	ProviderSettingsActionRequest,
	RuntimeLoggerConfig,
	SaveProviderSettingsActionRequest,
} from "./rpc/runtime";
export {
	ProviderCapabilitySchema,
	ProviderClientSchema,
	ProviderProtocolSchema,
} from "./rpc/runtime";
export type {
	TeamProgressCounts,
	TeamProgressLifecycleEvent,
	TeamProgressMemberRole,
	TeamProgressMemberStatus,
	TeamProgressOutcomeFragmentStatus,
	TeamProgressOutcomeStatus,
	TeamProgressProjectionEvent,
	TeamProgressRunStatus,
	TeamProgressSummary,
	TeamProgressTaskStatus,
} from "./rpc/team-progress";
export {
	TEAM_LIFECYCLE_EVENT_TYPE,
	TEAM_PROGRESS_EVENT_TYPE,
} from "./rpc/team-progress";
export type {
	ClineEnvironment,
	ClineEnvironmentConfig,
	ResolveClineEnvironmentOptions,
} from "./runtime/cline-environment";
export {
	CLINE_ENVIRONMENT_ENV,
	CLINE_ENVIRONMENT_OVERRIDE_ENV,
	CLINE_ENVIRONMENTS,
	DEFAULT_CLINE_ENVIRONMENT,
	getClineEnvironmentConfig,
	resolveClineEnvironment,
} from "./runtime/cline-environment";
export type {
	CaptureAgentUnexpectedReasoningTokensInput,
	CaptureSdkErrorInput,
	ITelemetryService,
	OpenTelemetryClientConfig,
	SdkTelemetryErrorComponent,
	SdkTelemetryErrorSeverity,
	TelemetryArray,
	TelemetryMetadata,
	TelemetryObject,
	TelemetryPrimitive,
	TelemetryProperties,
	TelemetryValue,
} from "./services/telemetry";
export {
	AGENT_UNEXPECTED_REASONING_TOKENS_EVENT,
	buildSdkErrorProperties,
	captureAgentUnexpectedReasoningTokens,
	captureSdkError,
	normalizeSdkError,
	SDK_ERROR_TELEMETRY_EVENT,
} from "./services/telemetry";
export type { ClineTelemetryServiceConfig } from "./services/telemetry-config";
export {
	createClineTelemetryServiceConfig,
	createClineTelemetryServiceMetadata,
} from "./services/telemetry-config";
export type {
	HookSessionContext,
	HookSessionContextLookup,
	HookSessionContextProvider,
} from "./session/hook-context";
export {
	resolveHookSessionContext,
	resolveRootSessionId,
} from "./session/hook-context";
export { createSessionId } from "./session/index";
export type {
	SessionLineage,
	SessionRuntimeRecordShape,
	SharedSessionStatus,
} from "./session/records";
export { SESSION_STATUS_VALUES } from "./session/records";
export type {
	AgentMode,
	RuntimeConfigExtensionKind,
	SessionExecutionConfig,
	SessionPromptConfig,
	SessionWorkspaceConfig,
} from "./session/runtime-config";
export {
	DEFAULT_RUNTIME_CONFIG_EXTENSIONS,
	hasRuntimeConfigExtension,
	isRuntimeConfigExtensionKind,
	parseRuntimeConfigExtensions,
	RUNTIME_CONFIG_EXTENSION_KINDS,
} from "./session/runtime-config";
export type { RuntimeEnv } from "./session/runtime-env";
export * from "./session/workspace";
export * from "./team";
export { createTool } from "./tools/create";
export { AUTH_ERROR_PATTERNS, isLikelyAuthError } from "./types/auth";
// VCR is Node-only (uses node:fs, node:path), excluded from browser build
export type { VcrRecording } from "./types/vcr";
