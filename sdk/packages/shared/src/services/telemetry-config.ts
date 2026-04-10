import type { OpenTelemetryClientConfig, TelemetryMetadata } from "./telemetry";

export interface ClineTelemetryServiceConfig extends OpenTelemetryClientConfig {
	metadata: TelemetryMetadata;
}

function getTelemetryBuildTimeConfig(): OpenTelemetryClientConfig {
	return {
		enabled:
			process?.env?.OTEL_TELEMETRY_ENABLED === "1" ||
			process?.env?.OTEL_TELEMETRY_ENABLED === "true",
		metricsExporter: process?.env?.OTEL_METRICS_EXPORTER || "otlp",
		logsExporter: process?.env?.OTEL_LOGS_EXPORTER || "otlp",
		tracesExporter: process?.env?.OTEL_TRACES_EXPORTER,
		otlpProtocol: process?.env?.OTEL_EXPORTER_OTLP_PROTOCOL || "http/json",
		otlpEndpoint: process?.env?.OTEL_EXPORTER_OTLP_ENDPOINT,
		metricExportInterval: process?.env?.OTEL_METRIC_EXPORT_INTERVAL
			? Number.parseInt(process?.env?.OTEL_METRIC_EXPORT_INTERVAL, 10)
			: undefined,
		otlpHeaders: process?.env?.OTEL_EXPORTER_OTLP_HEADERS
			? Object.fromEntries(
					process?.env?.OTEL_EXPORTER_OTLP_HEADERS.split(",").map((header) => {
						const [key, value] = header.split("=");
						return [key.trim(), value.trim()];
					}),
				)
			: undefined,
	};
}

export function createClineTelemetryServiceMetadata(
	overrides: Partial<TelemetryMetadata> = {},
): TelemetryMetadata {
	return {
		extension_version: "unknown",
		cline_type: "unknown",
		platform: "terminal",
		platform_version: process?.version || "unknown",
		os_type: process?.platform || "unknown",
		os_version:
			process?.platform === "win32"
				? (process?.env?.OS ?? "unknown")
				: "unknown",
		...overrides,
	};
}

export function createClineTelemetryServiceConfig(
	configOverrides: Partial<ClineTelemetryServiceConfig> = {},
): ClineTelemetryServiceConfig {
	return {
		...getTelemetryBuildTimeConfig(),
		...configOverrides,
		metadata: createClineTelemetryServiceMetadata(configOverrides.metadata),
	};
}
