/**
 * Core runtime services consumed by the standalone Hub daemon composition.
 *
 * Keep this boundary explicit. A broad Core barrel makes the daemon depend on
 * unrelated implementation details and previously caused Bun to emit an
 * invalid packed bundle when two transitive barrels exported the same symbol.
 */
export type { CronServiceOptions } from "../cron/service/cron-service";
export { CronService } from "../cron/service/cron-service";
export { HubScheduleCommandService } from "../cron/service/schedule-command-service";
export type {
	HubScheduleRuntimeHandlers,
	HubScheduleServiceOptions,
} from "../cron/service/schedule-service";
export { HubScheduleService } from "../cron/service/schedule-service";
export type { AvailableRuntimeCommand } from "../extensions/config/runtime-commands";
export { normalizeRuntimeCommandName } from "../extensions/config/runtime-commands";
export type {
	UserInstructionConfig,
	UserInstructionConfigType,
} from "../extensions/config/user-instruction-config-loader";
export type {
	UserInstructionConfigRecord,
	UserInstructionConfigService,
} from "../extensions/config/user-instruction-service";
export { createSkillsTool } from "../extensions/tools/definitions";
export type {
	SkillsExecutor,
	SkillsExecutorWithMetadata,
	ToolExecutors,
	VerifySubmitExecutor,
} from "../extensions/tools/types";
export { parseHookEventPayload } from "../hooks/subprocess";

export type { RuntimeCapabilities } from "../runtime/capabilities/runtime-capabilities";
export { normalizeConnectionUpdate } from "../runtime/config/connection-update";
export { LocalRuntimeHost } from "../runtime/host/local-runtime-host";
export type {
	LocalRuntimeStartOptions,
	PendingPromptsRuntimeService,
	RuntimeHost,
	RuntimeSessionConfig,
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionConnectionRuntimeService,
	SessionConnectionUpdate,
	SessionUsageRuntimeService,
	SessionUsageSummary,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/host/runtime-host";
export { readPersistedMessagesFile } from "../runtime/host/runtime-host-support";
export { DefaultRuntimeBuilder } from "../runtime/orchestration/runtime-builder";
export { formatRulesForSystemPrompt } from "../runtime/safety/rules";

export { listActiveConnectors } from "../services/connectors/active-connectors";
export { cleanupConnectorInstanceViaCli } from "../services/connectors/connector-cleanup";
export {
	ConnectorSupervisor,
	getActiveConnectorSupervisor,
	setActiveConnectorSupervisor,
} from "../services/connectors/connector-supervisor";
export { reconnectDaemonConnectors } from "../services/connectors/daemon-connector-reconnect";
export type { AuthSettings } from "../services/llms/provider-settings";
export { ProviderSettingsManager } from "../services/storage/provider-settings-manager";
export { SqliteSessionStore } from "../services/storage/sqlite-session-store";
export {
	captureToolUsage,
	identifyAccount,
} from "../services/telemetry/core-events";
export { createConfiguredTelemetryHandle } from "../services/telemetry/OpenTelemetryProvider";

export { withSessionHistoryOriginMetadata } from "../session/history-origin";
export {
	createSessionCompactionState,
	parseSessionCompactionState,
} from "../session/models/session-compaction";
export { CoreSessionService } from "../session/services/session-service";
export type { CoreSessionSnapshot } from "../session/session-snapshot";
export { createCoreSessionSnapshot } from "../session/session-snapshot";
export {
	SessionVersioningError,
	SessionVersioningService,
} from "../session/session-versioning-service";

export { CoreSettingsService } from "../settings/settings-service";
export type {
	CorePluginSettingsSnapshot,
	CorePluginSettingsSource,
	CoreSettingsListInput,
	CoreSettingsToggleInput,
	CoreSettingsType,
} from "../settings/types";
export { SessionSource } from "../types/common";
export type { CoreSessionConfig } from "../types/config";
export type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../types/events";
export type { SessionRecord } from "../types/sessions";
export { CORE_BUILD_VERSION } from "../version";
