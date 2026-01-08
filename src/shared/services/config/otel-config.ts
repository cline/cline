import { BUILD_CONSTANTS } from "@/shared/constants"
import { RemoteConfigFields } from "@/shared/storage/state-keys"

export interface OpenTelemetryClientConfig {
	/**
	 * Whether telemetry is enabled via OTEL_TELEMETRY_ENABLED
	 */
	enabled: boolean

	/**
	 * Metrics exporter type(s) - can be comma-separated for multiple exporters
	 * Examples: "console", "otlp", "prometheus", "console,otlp"
	 */
	metricsExporter?: string

	/**
	 * Logs/events exporter type(s) - can be comma-separated for multiple exporters
	 * Examples: "console", "otlp"
	 */
	logsExporter?: string

	/**
	 * Protocol for OTLP exporters: "grpc", "http/json", "http/protobuf"
	 */
	otlpProtocol?: string

	/**
	 * General OTLP endpoint (used if specific endpoints not set)
	 */
	otlpEndpoint?: string

	/**
	 * General OTLP headers
	 */
	otlpHeaders?: Record<string, string>

	/**
	 * Metrics-specific OTLP protocol
	 */
	otlpMetricsProtocol?: string

	/**
	 * Metrics-specific OTLP endpoint
	 */
	otlpMetricsEndpoint?: string

	/**
	 * Logs-specific OTLP protocol
	 */
	otlpLogsProtocol?: string

	/**
	 * Logs-specific OTLP endpoint
	 */
	otlpLogsEndpoint?: string

	/**
	 * Metric export interval in milliseconds (for console exporter)
	 */
	metricExportInterval?: number

	/**
	 * Whether to use insecure (non-TLS) connections for gRPC OTLP exporters
	 * Set to "true" for local development without TLS
	 * Default: false (uses TLS)
	 */
	otlpInsecure?: boolean

	/**
	 * Maximum batch size for log records (default: 512)
	 */
	logBatchSize?: number

	/**
	 * Maximum time to wait before exporting logs in milliseconds (default: 5000)
	 */
	logBatchTimeout?: number

	/**
	 * Maximum queue size for log records (default: 2048)
	 */
	logMaxQueueSize?: number
}

/**
 * Helper type for a valid OpenTelemetry client configuration.
 * Must have telemetry enabled and at least one exporter configured.
 */
export interface OpenTelemetryClientValidConfig extends OpenTelemetryClientConfig {
	enabled: true
}

const isTestEnv = process.env.E2E_TEST === "true" || process.env.IS_TEST === "true"

/**
 * Cached OpenTelemetry configuration.
 * Lazily initialized on first access to avoid race conditions with environment variable loading.
 */
let otelConfig: OpenTelemetryClientConfig | null = null

export function remoteConfigToOtelConfig(settings: Partial<RemoteConfigFields>): OpenTelemetryClientConfig {
	return {
		enabled: !!settings.openTelemetryEnabled,
		metricsExporter: settings.openTelemetryMetricsExporter,
		logsExporter: settings.openTelemetryLogsExporter,
		otlpProtocol: settings.openTelemetryOtlpProtocol,
		otlpEndpoint: settings.openTelemetryOtlpEndpoint,
		otlpHeaders: settings.openTelemetryOtlpHeaders,
		metricExportInterval: settings.openTelemetryMetricExportInterval,
		otlpInsecure: settings.openTelemetryOtlpInsecure,

		otlpMetricsEndpoint: settings.openTelemetryOtlpMetricsEndpoint,
		otlpMetricsProtocol: settings.openTelemetryOtlpMetricsProtocol,
		otlpLogsEndpoint: settings.openTelemetryOtlpLogsEndpoint,
		otlpLogsProtocol: settings.openTelemetryOtlpLogsProtocol,

		logBatchSize: settings.openTelemetryLogBatchSize,
		logBatchTimeout: settings.openTelemetryLogBatchTimeout,
		logMaxQueueSize: settings.openTelemetryLogMaxQueueSize,
	}
}

function getOtelConfig(): OpenTelemetryClientConfig {
	if (!otelConfig) {
		otelConfig = {
			enabled: BUILD_CONSTANTS.OTEL_TELEMETRY_ENABLED === "1",
			metricsExporter: BUILD_CONSTANTS.OTEL_METRICS_EXPORTER,
			logsExporter: BUILD_CONSTANTS.OTEL_LOGS_EXPORTER,
			otlpProtocol: BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_PROTOCOL,
			otlpEndpoint: BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_ENDPOINT,
			metricExportInterval: BUILD_CONSTANTS.OTEL_METRIC_EXPORT_INTERVAL
				? parseInt(BUILD_CONSTANTS.OTEL_METRIC_EXPORT_INTERVAL, 10)
				: undefined,
		}
	}
	return otelConfig
}

export function isOpenTelemetryConfigValid(config: OpenTelemetryClientConfig): config is OpenTelemetryClientValidConfig {
	// Disable in test environment to enable mocking and stubbing
	if (isTestEnv) {
		return false
	}

	if (!config.enabled) {
		return false
	}

	const hasOneExporterConfigured = !!(config.metricsExporter || config.logsExporter)
	return hasOneExporterConfigured
}

/**
 * Gets validated OpenTelemetry configuration if available.
 * Returns null if configuration is invalid or disabled.
 *
 * Configuration does not change at runtime - requires VSCode reload to pick up new values.
 *
 * @returns Valid OpenTelemetry configuration or null if disabled/invalid
 * @see .env.example for configuration options
 */
export function getValidOpenTelemetryConfig(): OpenTelemetryClientValidConfig | null {
	const config = getOtelConfig()
	return isOpenTelemetryConfigValid(config) ? config : null
}
