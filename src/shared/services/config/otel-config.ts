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

	otlpMetricsHeaders?: Record<string, string>

	/**
	 * Logs-specific OTLP protocol
	 */
	otlpLogsProtocol?: string

	/**
	 * Logs-specific OTLP endpoint
	 */
	otlpLogsEndpoint?: string

	otlpLogsHeaders?: Record<string, string>

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
		otlpMetricsHeaders: settings.otlpMetricsHeaders,
		otlpLogsEndpoint: settings.openTelemetryOtlpLogsEndpoint,
		otlpLogsProtocol: settings.openTelemetryOtlpLogsProtocol,
		otlpLogsHeaders: settings.otlpLogsHeaders,

		logBatchSize: settings.openTelemetryLogBatchSize,
		logBatchTimeout: settings.openTelemetryLogBatchTimeout,
		logMaxQueueSize: settings.openTelemetryLogMaxQueueSize,
	}
}

function getOtelConfig(): OpenTelemetryClientConfig {
	return {
		enabled: BUILD_CONSTANTS.OTEL_TELEMETRY_ENABLED === "1" || BUILD_CONSTANTS.OTEL_TELEMETRY_ENABLED === "true",
		metricsExporter: BUILD_CONSTANTS.OTEL_METRICS_EXPORTER,
		logsExporter: BUILD_CONSTANTS.OTEL_LOGS_EXPORTER,
		otlpProtocol: BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_PROTOCOL,
		otlpEndpoint: BUILD_CONSTANTS.OTEL_EXPORTER_OTLP_ENDPOINT,
		metricExportInterval: BUILD_CONSTANTS.OTEL_METRIC_EXPORT_INTERVAL
			? parseInt(BUILD_CONSTANTS.OTEL_METRIC_EXPORT_INTERVAL, 10)
			: undefined,
	}
}

/**
 * Gets or creates the OpenTelemetry configuration from environment variables.
 * Configuration is cached after first access for performance.
 *
 * Configuration Sources:
 * - **Production Build**: Environment variables injected by esbuild at build time
 *   via .github/workflows/publish.yml
 * - **Development**: Environment variables from .env file loaded by VSCode
 *
 * Supported Environment Variables:
 * - CLINE_OTEL_TELEMETRY_ENABLED: "1" to enable OpenTelemetry (default: off)
 * - CLINE_OTEL_METRICS_EXPORTER: Comma-separated list: "console", "otlp", "prometheus"
 * - CLINE_OTEL_LOGS_EXPORTER: Comma-separated list: "console", "otlp"
 * - CLINE_OTEL_EXPORTER_OTLP_PROTOCOL: "grpc", "http/json", or "http/protobuf"
 * - CLINE_OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector endpoint (if not using specific endpoints)
 * - CLINE_OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: Metrics-specific protocol override
 * - CLINE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: Metrics-specific endpoint override
 * - CLINE_OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: Logs-specific protocol override
 * - CLINE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: Logs-specific endpoint override
 * - CLINE_OTEL_METRIC_EXPORT_INTERVAL: Milliseconds between metric exports (default: 60000)
 * - CLINE_OTEL_EXPORTER_OTLP_INSECURE: "true" to disable TLS for gRPC (for local development)
 * - CLINE_OTEL_LOG_BATCH_SIZE: Maximum batch size for log records (default: 512)
 * - CLINE_OTEL_LOG_BATCH_TIMEOUT: Maximum time to wait before exporting logs in ms (default: 5000)
 * - CLINE_OTEL_LOG_MAX_QUEUE_SIZE: Maximum queue size for log records (default: 2048)
 *
 * @private
 * @see .env.example for development setup
 * @see .github/workflows/publish.yml for production environment variable injection
 */
function getRuntimeOtelConfig(): OpenTelemetryClientConfig {
	return {
		enabled: process.env.CLINE_OTEL_TELEMETRY_ENABLED === "true",
		metricsExporter: process.env.CLINE_OTEL_METRICS_EXPORTER,
		logsExporter: process.env.CLINE_OTEL_LOGS_EXPORTER,
		otlpProtocol: process.env.CLINE_OTEL_EXPORTER_OTLP_PROTOCOL,
		otlpEndpoint: process.env.CLINE_OTEL_EXPORTER_OTLP_ENDPOINT,
		otlpMetricsProtocol: process.env.CLINE_OTEL_EXPORTER_OTLP_METRICS_PROTOCOL,
		otlpMetricsEndpoint: process.env.CLINE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
		otlpLogsProtocol: process.env.CLINE_OTEL_EXPORTER_OTLP_LOGS_PROTOCOL,
		otlpLogsEndpoint: process.env.CLINE_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
		metricExportInterval: process.env.CLINE_OTEL_METRIC_EXPORT_INTERVAL
			? parseInt(process.env.CLINE_OTEL_METRIC_EXPORT_INTERVAL, 10)
			: undefined,
		otlpInsecure: process.env.CLINE_OTEL_EXPORTER_OTLP_INSECURE === "true",
		logBatchSize: process.env.CLINE_OTEL_LOG_BATCH_SIZE
			? Math.max(1, parseInt(process.env.CLINE_OTEL_LOG_BATCH_SIZE, 10))
			: undefined,
		logBatchTimeout: process.env.CLINE_OTEL_LOG_BATCH_TIMEOUT
			? Math.max(1, parseInt(process.env.CLINE_OTEL_LOG_BATCH_TIMEOUT, 10))
			: undefined,
		logMaxQueueSize: process.env.CLINE_OTEL_LOG_MAX_QUEUE_SIZE
			? Math.max(1, parseInt(process.env.CLINE_OTEL_LOG_MAX_QUEUE_SIZE, 10))
			: undefined,
	}
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

export function getValidRuntimeOpenTelemetryConfig(): OpenTelemetryClientValidConfig | null {
	const config = getRuntimeOtelConfig()
	return isOpenTelemetryConfigValid(config) ? config : null
}
