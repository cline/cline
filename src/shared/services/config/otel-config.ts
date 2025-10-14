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

/**
 * Gets or creates the OpenTelemetry configuration with proper precedence.
 * Configuration is cached after first access for performance.
 *
 * Configuration Precedence (lowest to highest):
 * 1. **Build-time**: Environment variables injected by esbuild at build time via .github/workflows/publish.yml
 * 2. **Runtime Environment Variables**: Environment variables from .env file or startup
 * 3. **Settings**: Values from StateManager (can be set via UI or remote config)
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
 * - OTEL_LOG_BATCH_SIZE: Maximum batch size for log records (default: 512)
 * - OTEL_LOG_BATCH_TIMEOUT: Maximum time to wait before exporting logs in ms (default: 5000)
 * - OTEL_LOG_MAX_QUEUE_SIZE: Maximum queue size for log records (default: 2048)
 *
 * @private
 * @see .env.example for development setup
 * @see .github/workflows/publish.yml for production environment variable injection
 */
function getOtelConfig(): OpenTelemetryClientConfig {
	if (!otelConfig) {
		// Start with build-time/environment variable config (lowest precedence)
		const baseConfig: OpenTelemetryClientConfig = {
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
			logBatchSize: process.env.OTEL_LOG_BATCH_SIZE
				? Math.max(1, parseInt(process.env.OTEL_LOG_BATCH_SIZE, 10))
				: undefined,
			logBatchTimeout: process.env.OTEL_LOG_BATCH_TIMEOUT
				? Math.max(1, parseInt(process.env.OTEL_LOG_BATCH_TIMEOUT, 10))
				: undefined,
			logMaxQueueSize: process.env.OTEL_LOG_MAX_QUEUE_SIZE
				? Math.max(1, parseInt(process.env.OTEL_LOG_MAX_QUEUE_SIZE, 10))
				: undefined,
		}

		// Try to get settings from StateManager (highest precedence)
		// Note: StateManager may not be initialized yet during early extension startup
		const settingsOverrides: Partial<OpenTelemetryClientConfig> = {}
		try {
			// Dynamic import to avoid circular dependencies
			const { StateManager } = require("@/core/storage/StateManager")
			const stateManager = StateManager.get()

			if (stateManager?.isInitialized) {
				// Apply settings overrides if they exist
				const settings = stateManager.state

				if (settings.openTelemetryEnabled !== undefined) {
					settingsOverrides.enabled = settings.openTelemetryEnabled
				}
				if (settings.openTelemetryMetricsExporter !== undefined) {
					settingsOverrides.metricsExporter = settings.openTelemetryMetricsExporter
				}
				if (settings.openTelemetryLogsExporter !== undefined) {
					settingsOverrides.logsExporter = settings.openTelemetryLogsExporter
				}
				if (settings.openTelemetryOtlpProtocol !== undefined) {
					settingsOverrides.otlpProtocol = settings.openTelemetryOtlpProtocol
				}
				if (settings.openTelemetryOtlpEndpoint !== undefined) {
					settingsOverrides.otlpEndpoint = settings.openTelemetryOtlpEndpoint
				}
				if (settings.openTelemetryOtlpMetricsProtocol !== undefined) {
					settingsOverrides.otlpMetricsProtocol = settings.openTelemetryOtlpMetricsProtocol
				}
				if (settings.openTelemetryOtlpMetricsEndpoint !== undefined) {
					settingsOverrides.otlpMetricsEndpoint = settings.openTelemetryOtlpMetricsEndpoint
				}
				if (settings.openTelemetryOtlpLogsProtocol !== undefined) {
					settingsOverrides.otlpLogsProtocol = settings.openTelemetryOtlpLogsProtocol
				}
				if (settings.openTelemetryOtlpLogsEndpoint !== undefined) {
					settingsOverrides.otlpLogsEndpoint = settings.openTelemetryOtlpLogsEndpoint
				}
				if (settings.openTelemetryMetricExportInterval !== undefined) {
					settingsOverrides.metricExportInterval = settings.openTelemetryMetricExportInterval
				}
				if (settings.openTelemetryOtlpInsecure !== undefined) {
					settingsOverrides.otlpInsecure = settings.openTelemetryOtlpInsecure
				}
				if (settings.openTelemetryLogBatchSize !== undefined) {
					settingsOverrides.logBatchSize = settings.openTelemetryLogBatchSize
				}
				if (settings.openTelemetryLogBatchTimeout !== undefined) {
					settingsOverrides.logBatchTimeout = settings.openTelemetryLogBatchTimeout
				}
				if (settings.openTelemetryLogMaxQueueSize !== undefined) {
					settingsOverrides.logMaxQueueSize = settings.openTelemetryLogMaxQueueSize
				}
			}
		} catch (error) {
			// StateManager not available yet (early startup) - use base config only
			console.log("[OTEL] StateManager not available, using environment config only")
		}

		// Merge base config with settings overrides
		otelConfig = { ...baseConfig, ...settingsOverrides }
	}
	return otelConfig
}

/**
 * Clears the cached OpenTelemetry configuration.
 * Should be called when settings change to force re-evaluation.
 */
export function clearOtelConfigCache(): void {
	otelConfig = null
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
