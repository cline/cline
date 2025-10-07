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

	/**
	 * Whether to use insecure (non-TLS) connections for gRPC OTLP exporters
	 * Set to "true" for local development without TLS
	 * Default: false (uses TLS)
	 */
	otlpInsecure?: boolean
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
 * - OTEL_TELEMETRY_ENABLED: "1" to enable OpenTelemetry (default: off)
 * - OTEL_METRICS_EXPORTER: Comma-separated list: "console", "otlp", "prometheus"
 * - OTEL_LOGS_EXPORTER: Comma-separated list: "console", "otlp"
 * - OTEL_EXPORTER_OTLP_PROTOCOL: "grpc", "http/json", or "http/protobuf"
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector endpoint (if not using specific endpoints)
 * - OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: Metrics-specific protocol override
 * - OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: Metrics-specific endpoint override
 * - OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: Logs-specific protocol override
 * - OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: Logs-specific endpoint override
 * - OTEL_METRIC_EXPORT_INTERVAL: Milliseconds between metric exports (default: 60000)
 * - OTEL_EXPORTER_OTLP_INSECURE: "true" to disable TLS for gRPC (for local development)
 *
 * @private
 * @see .env.example for development setup
 * @see .github/workflows/publish.yml for production environment variable injection
 */
function getOtelConfig(): OpenTelemetryClientConfig {
	if (!otelConfig) {
		otelConfig = {
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
			otlpInsecure: process.env.OTEL_EXPORTER_OTLP_INSECURE === "true",
		}
	}
	return otelConfig
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
