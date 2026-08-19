/**
 * `@cline/gateway`
 *
 * The Gateway is the runtime authority of the Gateway RFC: transport,
 * persistence, configuration, credentials, shared resources, schedules,
 * and process supervision. Phase 0 contributed the private command
 * registry, `gateway.hello` negotiation, and the idempotency contract;
 * Phase 3 adds the authority itself — the OS-backed exclusive lock, the
 * SQLite store with migrations, the loopback server with per-instance
 * auth, the async run runtime (durable FIFO queue, attempts/retry, event
 * replay, approvals), outbox-driven disk projections, and the lifecycle
 * CLI (`serve`/`start`/`status`/`drain`/`upgrade`/`stop`).
 *
 * Reusable wire contracts live in `@cline/shared/gateway`; apps never
 * import this package's internals.
 */

export type { GatewayCliCommand, GatewayCliIo } from "./cli";
export { GATEWAY_CLI_COMMANDS, runGatewayCli } from "./cli";
export type {
	ApprovalResolution,
	GatewayClientOptions,
	GatewayEventListener,
	GatewayServerRequestHandler,
	GatewayStatusSummary,
	StartRunInput,
} from "./client";
export { GatewayClient, GatewayRequestError } from "./client";
export type {
	ConnectorAdapter,
	ConnectorAdapterContext,
} from "./connectors/adapter";
export type { ConnectorManagerOptions } from "./connectors/manager";
export { ConnectorManager } from "./connectors/manager";
export type {
	SlackAdapterOptions,
	SlackSocket,
	SlackSocketFactory,
} from "./connectors/slack";
export {
	parseSlackCredential,
	SlackConnectorAdapter,
} from "./connectors/slack";
export type {
	ConnectorInstanceClaim,
	ConnectorRecord,
	ConnectorStatus,
} from "./connectors/store";
export {
	ConnectorCursorStore,
	ConnectorInstanceStore,
	ConnectorScopeViolationError,
	ConnectorStore,
	SqliteConnectorRouteStore,
} from "./connectors/store";
export type { TelegramAdapterOptions } from "./connectors/telegram";
export { TelegramConnectorAdapter } from "./connectors/telegram";
export type { GatewayMigration } from "./db";
export {
	GATEWAY_MIGRATIONS,
	GatewayDatabase,
	migrateGatewayDatabase,
	openGatewayDatabase,
} from "./db";
export type { DiscoveryRecord } from "./discovery";
export {
	createInstanceAuthToken,
	DiscoveryRecordSchema,
	readDiscoveryRecord,
	removeDiscoveryRecord,
	writeDiscoveryRecord,
} from "./discovery";
export type {
	ConfiguredEngineOptions,
	ResolveProviderModelOptions,
} from "./engine-binding";
export {
	createConfiguredEnginePort,
	MissingProviderCredentialError,
	ModelNotConfiguredError,
	resolveProviderModel,
} from "./engine-binding";
export {
	gatewayProviderSettingsPath,
	listSavedProviderSummaries,
	readSavedProviderSelection,
	savedProviderApiKey,
	savedProviderOptions,
} from "./provider-settings";
export type { GatewayIdentityInfo, HelloNegotiation } from "./hello";
export {
	negotiateHello,
	SUPPORTED_PROTOCOL_VERSIONS,
} from "./hello";
export type { IdempotencyBeginOutcome } from "./idempotency-ledger";
export {
	IdempotencyLedger,
	stableStringify,
} from "./idempotency-ledger";
export { GatewayLock, GatewayLockHeldError } from "./lock";
export type {
	McpHttpTransportSpec,
	McpServerDefinition,
	McpStdioTransportSpec,
	McpTransportSpec,
} from "./mcp/definitions";
export {
	definitionRevision,
	definitionsFromPlugin,
} from "./mcp/definitions";
export type {
	McpAcquireContext,
	McpClientConnection,
	McpLease,
	McpPoolOptions,
	McpToolDescriptor,
} from "./mcp/pool";
export {
	McpConnectBackoffError,
	McpConnectionPool,
	mcpPoolKey,
} from "./mcp/pool";
export type {
	McpTransport,
	McpTransportContext,
	McpTransportFactory,
} from "./mcp/transport";
export {
	createStdioTransportFactory,
	StdioMcpTransport,
} from "./mcp/transport";
export type { McpToolPolicy } from "./mcp/views";
export { McpToolDeniedError, SessionMcpToolView } from "./mcp/views";
export type {
	GatewayMethodDefinition,
	ValidatedGatewayRequest,
} from "./methods";
export {
	GATEWAY_METHODS,
	getMethodDefinition,
	validateGatewayRequest,
} from "./methods";
export type { OutboxProjector, OutboxWorkerOptions } from "./outbox";
export {
	createFileProjector,
	OUTBOX_KIND_SESSION_PROJECTION,
	OutboxWorker,
} from "./outbox";
export type { GatewayPaths, GatewayPathsOptions } from "./paths";
export {
	DEFAULT_GATEWAY_NAMESPACE,
	defaultGatewayDataRoot,
	ensureGatewayDataDir,
	GATEWAY_DATA_ROOT_ENV,
	GATEWAY_NAMESPACE_ENV,
	resolveGatewayNamespace,
	resolveGatewayPaths,
} from "./paths";
export type {
	BoundPlugin,
	PluginViewPolicy,
	SessionPluginContext,
	SessionPluginView,
} from "./plugins/bindings";
export { createSessionPluginView } from "./plugins/bindings";
export type {
	CatalogDiagnostic,
	CatalogEntry,
	CatalogGenerationSnapshot,
	CatalogPin,
	CatalogReloadReport,
	PluginCatalogOptions,
	PluginScope,
	PluginSource,
} from "./plugins/catalog";
export { PluginCatalog, pluginScopeKey } from "./plugins/catalog";
export type {
	LoadedMcpServer,
	LoadedPlugin,
	LoadedSkill,
	PluginLoadResult,
} from "./plugins/loader";
export { fingerprintPluginDir, loadPlugin } from "./plugins/loader";
export type {
	AgentPluginManifest,
	ManifestValidation,
	PluginDiagnostic,
	PluginDiagnosticSeverity,
} from "./plugins/manifest";
export {
	AGENT_PLUGIN_SCHEMA_1_0_0,
	isValidPluginName,
	SUPPORTED_PLUGIN_SCHEMAS,
	validatePluginManifest,
} from "./plugins/manifest";
export type {
	PluginStateScope,
	PluginStateStorePort,
} from "./plugins/state-store";
export { PluginStateStore } from "./plugins/state-store";
export { RunProvenanceStore } from "./provenance-store";
export type {
	EngineRetryPolicy,
	GatewayRecoveryReport,
	GatewayRuntimeOptions,
	RunStartParams,
	SessionSnapshot,
} from "./runtime";
export {
	ApprovalBroker,
	AttemptingEnginePort,
	GATEWAY_EXECUTION_MODE,
	GatewayCallError,
	GatewayRuntime,
	MANAGED_WORKSPACE_ROOT,
	toGatewayError,
} from "./runtime";
export type {
	SchedulerOptions,
	SchedulerTickReport,
} from "./schedules/scheduler";
export { Scheduler } from "./schedules/scheduler";
export type {
	ScheduleJobRecord,
	ScheduleJobState,
	ScheduleRecord,
} from "./schedules/store";
export { ScheduleJobStore, ScheduleStore } from "./schedules/store";
export { readSecretFile, SecretAccessError, writeSecretFile } from "./secrets";
export type { GatewayServerOptions } from "./server";
export { GatewayServer } from "./server";
export type {
	AuditEntry,
	ClientRecord,
	GatewayStores,
	OutboxEntry,
	RunAttemptRecord,
	StoredMessage,
} from "./stores";
export {
	AuditLog,
	ClientRegistryStore,
	createGatewayStores,
	EventLogStore,
	MessageHistoryStore,
	MetaStore,
	OutboxStore,
	RunAttemptStore,
	SqliteBotRepository,
	SqliteIdempotencyLedger,
	SqliteRunRepository,
	SqliteSessionRepository,
} from "./stores";
export type {
	NormalizedModelCall,
	PriceResolver,
	PriceSnapshot,
	StatisticsRange,
	UsageEventRecord,
	UsageStoreOptions,
} from "./usage";
export {
	MAX_STATISTICS_RANGE_DAYS,
	UsageQueryError,
	UsageStore,
	utcDateOf,
} from "./usage";
export type {
	WorkerConnection,
	WorkerCredentialCapability,
	WorkerDriver,
	WorkerDriverAvailability,
	WorkerExitInfo,
	WorkerIsolationMode,
	WorkerNetworkPolicy,
	WorkerSpawnSpec,
} from "./workers/driver";
export { WorkerIsolationUnavailableError } from "./workers/driver";
export type {
	WorkerEndpoint,
	WorkerHostContext,
	WorkerHostOptions,
	WorkerWorkloadFactory,
} from "./workers/host";
export { WorkerHost } from "./workers/host";
export { InProcessWorkerDriver } from "./workers/in-process-driver";
export type {
	SandboxProcessDriverOptions,
	WorkerEntrySpec,
} from "./workers/process-driver";
export { SandboxProcessWorkerDriver } from "./workers/process-driver";
export type {
	SupervisorToWorkerMessage,
	WorkerInvocation,
	WorkerOutcome,
	WorkerToSupervisorMessage,
} from "./workers/protocol";
export {
	SupervisorToWorkerMessageSchema,
	WORKER_PROTOCOL_VERSION,
	WorkerToSupervisorMessageSchema,
} from "./workers/protocol";
export type {
	SupervisorIsolationPolicy,
	WorkerCapabilityHandler,
	WorkerSupervisorOptions,
} from "./workers/supervisor";
export {
	WorkerCrashedError,
	WorkerSupervisor,
} from "./workers/supervisor";
export type { WorkerEntryOptions } from "./workers/worker-entry";
export {
	createStreamWorkerEndpoint,
	defaultWorkerWorkload,
	runWorkerEntry,
} from "./workers/worker-entry";
export type { BotMountPolicy } from "./workspaces";
export { BotWorkspaceManager, WorkspacePathError } from "./workspaces";
