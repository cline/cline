import type { OpenTelemetryClientConfig } from "../services/telemetry";
import type {
	RemoteConfigBundle,
	RemoteConfigSyncContext,
	RemoteConfigTelemetryAdapter,
} from "./bundle";
import type { RemoteConfig } from "./schema";

export function resolveOpenTelemetryConfigFromRemoteConfig(
	remoteConfig: RemoteConfig | undefined,
): Partial<OpenTelemetryClientConfig> | undefined {
	if (!remoteConfig) {
		return undefined;
	}
	return {
		enabled: remoteConfig.openTelemetryEnabled ?? false,
		metricsExporter: remoteConfig.openTelemetryMetricsExporter,
		logsExporter: remoteConfig.openTelemetryLogsExporter,
		otlpProtocol: remoteConfig.openTelemetryOtlpProtocol,
		otlpEndpoint: remoteConfig.openTelemetryOtlpEndpoint,
		otlpHeaders: remoteConfig.openTelemetryOtlpHeaders,
		otlpMetricsProtocol: remoteConfig.openTelemetryOtlpMetricsProtocol,
		otlpMetricsEndpoint: remoteConfig.openTelemetryOtlpMetricsEndpoint,
		otlpMetricsHeaders: remoteConfig.openTelemetryOtlpMetricsHeaders,
		otlpLogsProtocol: remoteConfig.openTelemetryOtlpLogsProtocol,
		otlpLogsEndpoint: remoteConfig.openTelemetryOtlpLogsEndpoint,
		otlpLogsHeaders: remoteConfig.openTelemetryOtlpLogsHeaders,
		metricExportInterval: remoteConfig.openTelemetryMetricExportInterval,
		otlpInsecure: remoteConfig.openTelemetryOtlpInsecure,
		logBatchSize: remoteConfig.openTelemetryLogBatchSize,
		logBatchTimeout: remoteConfig.openTelemetryLogBatchTimeout,
		logMaxQueueSize: remoteConfig.openTelemetryLogMaxQueueSize,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
	record: Record<string, unknown>,
	key: keyof OpenTelemetryClientConfig,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function readBoolean(
	record: Record<string, unknown>,
	key: keyof OpenTelemetryClientConfig,
): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function readNumber(
	record: Record<string, unknown>,
	key: keyof OpenTelemetryClientConfig,
): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function readStringRecord(
	record: Record<string, unknown>,
	key: "otlpHeaders" | "otlpMetricsHeaders" | "otlpLogsHeaders",
): Record<string, string> | undefined {
	const value = record[key];
	if (!isRecord(value)) {
		return undefined;
	}
	const entries = Object.entries(value).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function normalizeBundleTelemetry(
	telemetry: Record<string, unknown> | undefined,
): Partial<OpenTelemetryClientConfig> | undefined {
	if (!isRecord(telemetry)) {
		return undefined;
	}
	const normalized: Partial<OpenTelemetryClientConfig> = {
		enabled: readBoolean(telemetry, "enabled"),
		metricsExporter: readString(telemetry, "metricsExporter"),
		logsExporter: readString(telemetry, "logsExporter"),
		otlpProtocol: readString(telemetry, "otlpProtocol"),
		otlpEndpoint: readString(telemetry, "otlpEndpoint"),
		otlpHeaders: readStringRecord(telemetry, "otlpHeaders"),
		otlpMetricsProtocol: readString(telemetry, "otlpMetricsProtocol"),
		otlpMetricsEndpoint: readString(telemetry, "otlpMetricsEndpoint"),
		otlpMetricsHeaders: readStringRecord(telemetry, "otlpMetricsHeaders"),
		otlpLogsProtocol: readString(telemetry, "otlpLogsProtocol"),
		otlpLogsEndpoint: readString(telemetry, "otlpLogsEndpoint"),
		otlpLogsHeaders: readStringRecord(telemetry, "otlpLogsHeaders"),
		metricExportInterval: readNumber(telemetry, "metricExportInterval"),
		otlpInsecure: readBoolean(telemetry, "otlpInsecure"),
		logBatchSize: readNumber(telemetry, "logBatchSize"),
		logBatchTimeout: readNumber(telemetry, "logBatchTimeout"),
		logMaxQueueSize: readNumber(telemetry, "logMaxQueueSize"),
	};
	return Object.values(normalized).some((value) => value !== undefined)
		? normalized
		: undefined;
}

export class DefaultRemoteConfigTelemetryAdapter
	implements RemoteConfigTelemetryAdapter
{
	name = "remote-config";

	resolveTelemetry(
		bundle: RemoteConfigBundle,
		_context: RemoteConfigSyncContext,
	): Partial<OpenTelemetryClientConfig> | undefined {
		return {
			...resolveOpenTelemetryConfigFromRemoteConfig(bundle.remoteConfig),
			...normalizeBundleTelemetry(bundle.telemetry),
		};
	}
}
