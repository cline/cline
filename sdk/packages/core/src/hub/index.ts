export type { ITelemetryService } from "@clinebot/shared";
export { HubScheduleCommandService } from "../cron/service/schedule-command-service";
export { HubScheduleService } from "../cron/service/schedule-service";
/**
 * Re-exported so detached hub daemon entry points (e.g. the VS Code
 * `hub-daemon.ts` companion process) can construct a telemetry service
 * from a single `@clinebot/core/hub` import. The hub daemon is the
 * canonical owner of telemetry forwarding for sessions executed inside
 * the detached process, so the factory belongs on the hub surface even
 * though its implementation lives under `services/telemetry`.
 *
 * `createConfiguredTelemetryHandle` is the preferred entry point for
 * hosts: it bundles the telemetry service together with the canonical
 * `flush`/`dispose` closures so detached daemons, the VS Code extension,
 * and the CLI can share one implementation instead of each
 * re-deriving the same lifecycle plumbing.
 */
export {
	type ConfiguredTelemetryHandle,
	type CreateOpenTelemetryTelemetryServiceOptions,
	createConfiguredTelemetryHandle,
	createConfiguredTelemetryService,
} from "../services/telemetry/OpenTelemetryProvider";
export * from "./client";
export * from "./client/connect";
export * from "./client/session-client";
export * from "./client/ui-client";
export * from "./daemon";
export * from "./daemon/runtime-handlers";
export * from "./daemon/start-shared-server";
export * from "./discovery";
export * from "./discovery/defaults";
export * from "./discovery/workspace";
export * from "./server";
export * from "./server/browser-websocket";
export * from "./server/command-transport";
export * from "./server/native-transport";
