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
 * OpenTelemetry configuration based on standard OTEL environment variables.
 * Supports multiple exporters and protocols for flexible telemetry collection.
 */
const otelConfig: OpenTelemetryClientConfig = {
	enabled: process.env.OTEL_TELEMETRY_ENABLED === "1",
	metricsExporter: process.env.OTEL_METRICS_EXPORTER,
	logsExporter: process.env.OTEL_LOGS_EXPORTER,
	otlpProtocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
	otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
	otlpMetricsProtocol: process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL,
	otlpMetricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
	otlpLogsProtocol: process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL,
	otlpLogsEndpoint: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
	metricExportInterval: process.env.OTEL_METRIC_EXPORT_INTERVAL
		? parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL, 10)
		: undefined,
}

export function isOpenTelemetryConfigValid(config: OpenTelemetryClientConfig): config is OpenTelemetryClientValidConfig {
	// Disable in test environment to enable mocking and stubbing
	if (isTestEnv) {
		return false
	}

	// Must be explicitly enabled
	if (!config.enabled) {
		return false
	}

	// Must have at least one exporter configured
	return !!(config.metricsExporter || config.logsExporter)
}

export function getValidOpenTelemetryConfig(): OpenTelemetryClientValidConfig | null {
	return isOpenTelemetryConfigValid(otelConfig) ? (otelConfig as OpenTelemetryClientValidConfig) : null
}
