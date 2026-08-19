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
	GatewayClientOptions,
	GatewayEventListener,
	GatewayServerRequestHandler,
} from "./client";
export { GatewayClient, GatewayRequestError } from "./client";
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
	EngineRetryPolicy,
	GatewayRecoveryReport,
	GatewayRuntimeOptions,
	RunStartParams,
} from "./runtime";
export {
	ApprovalBroker,
	AttemptingEnginePort,
	GatewayCallError,
	GatewayRuntime,
	MANAGED_WORKSPACE_ROOT,
	toGatewayError,
} from "./runtime";
export {
	readSecretFile,
	SecretAccessError,
	writeSecretFile,
} from "./secrets";
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
