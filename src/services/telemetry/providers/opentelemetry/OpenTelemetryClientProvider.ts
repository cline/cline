import { metrics } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { Resource } from "@opentelemetry/resources"
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs"
import { MeterProvider } from "@opentelemetry/sdk-metrics"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { ExtensionRegistryInfo } from "@/registry"
import { getValidOpenTelemetryConfig, OpenTelemetryClientValidConfig } from "@/shared/services/config/otel-config"
import {
	createConsoleLogExporter,
	createConsoleMetricReader,
	createOTLPLogExporter,
	createOTLPMetricReader,
} from "./OpenTelemetryExporterFactory"

/**
 * Singleton provider for OpenTelemetry client instances.
 * Manages meter and logger providers for telemetry collection.
 */
export class OpenTelemetryClientProvider {
	private static _instance: OpenTelemetryClientProvider | null = null

	public static getInstance(): OpenTelemetryClientProvider {
		if (!OpenTelemetryClientProvider._instance) {
			OpenTelemetryClientProvider._instance = new OpenTelemetryClientProvider()
		}
		return OpenTelemetryClientProvider._instance
	}

	public static getMeterProvider(): MeterProvider | null {
		return OpenTelemetryClientProvider.getInstance().meterProvider
	}

	public static getLoggerProvider(): LoggerProvider | null {
		return OpenTelemetryClientProvider.getInstance().loggerProvider
	}

	private readonly meterProvider: MeterProvider | null = null
	private readonly loggerProvider: LoggerProvider | null = null
	private readonly config: OpenTelemetryClientValidConfig | null

	/**
	 * Check if debug diagnostics are enabled.
	 * Only log sensitive information (endpoints, headers) when in debug mode.
	 */
	private isDebugEnabled(): boolean {
		return process.env.TEL_DEBUG_DIAGNOSTICS === "true" || process.env.IS_DEV === "true"
	}

	private constructor() {
		this.config = getValidOpenTelemetryConfig()

		if (!this.config) {
			console.log("[OTEL DEBUG] OpenTelemetry is disabled or not configured")
			return
		}

		const isDebugMode = this.isDebugEnabled()

		// Only log endpoint in debug mode (security: avoid exposing infrastructure details)
		if (isDebugMode) {
			console.log("[OTEL DEBUG] ========== OpenTelemetry Initialization ==========")
			console.log(`[OTEL DEBUG] Configuration:`)
			console.log(`[OTEL DEBUG]   - Metrics Exporter: ${this.config.metricsExporter || "none"}`)
			console.log(`[OTEL DEBUG]   - Logs Exporter: ${this.config.logsExporter || "none"}`)
			console.log(`[OTEL DEBUG]   - OTLP Protocol: ${this.config.otlpProtocol || "grpc (default)"}`)

			console.log(`[OTEL DEBUG]   - OTLP Endpoint: ${this.config.otlpEndpoint || "not set"}`)
			console.log(`[OTEL DEBUG]   - OTLP Insecure: ${this.config.otlpInsecure || false}`)
			console.log(`[OTEL DEBUG]   - Metric Export Interval: ${this.config.metricExportInterval || 60000}ms`)
		}

		// Check for headers configuration (via environment variable)
		const hasHeaders = !!process.env.OTEL_EXPORTER_OTLP_HEADERS
		if (isDebugMode && hasHeaders) {
			// In debug mode, show that headers are configured and their total length
			const headerLength = process.env.OTEL_EXPORTER_OTLP_HEADERS!.length
			console.log(`[OTEL DEBUG]   - OTLP Headers: configured (length: ${headerLength})`)
			console.log("[OTEL DEBUG] ================================================")
		}

		// Create resource with service information
		const resource = new Resource({
			[ATTR_SERVICE_NAME]: "cline",
			[ATTR_SERVICE_VERSION]: ExtensionRegistryInfo.version,
		})

		// Initialize metrics if configured
		if (this.config.metricsExporter) {
			this.meterProvider = this.createMeterProvider(resource)
		}

		// Initialize logs if configured
		if (this.config.logsExporter) {
			this.loggerProvider = this.createLoggerProvider(resource)
		}

		console.log("[OTEL DEBUG] OpenTelemetry initialization complete")
	}

	private createMeterProvider(resource: Resource): MeterProvider {
		const exporters = this.config!.metricsExporter!.split(",").map((type) => type.trim())
		const readers: any[] = []
		const interval = this.config!.metricExportInterval || 60000
		const timeout = Math.min(Math.floor(interval * 0.8), 30000)

		console.log(`[OTEL] Creating MeterProvider with exporters: ${exporters.join(", ")}`)

		for (const exporterType of exporters) {
			try {
				switch (exporterType) {
					case "console": {
						const reader = createConsoleMetricReader(interval, timeout)
						readers.push(reader)
						console.log(`[OTEL] Console metrics reader created (interval: ${interval}ms)`)
						break
					}
					case "otlp": {
						const protocol = this.config!.otlpMetricsProtocol || this.config!.otlpProtocol || "grpc"
						const endpoint = this.config!.otlpMetricsEndpoint || this.config!.otlpEndpoint
						const insecure = this.config!.otlpInsecure || false

						if (endpoint) {
							const reader = createOTLPMetricReader(protocol, endpoint, insecure, interval, timeout)
							if (reader) {
								readers.push(reader)
								console.log(`[OTEL] OTLP metrics reader created (${protocol}, interval: ${interval}ms)`)
							}
						} else {
							console.warn("[OTEL] OTLP metrics exporter requires an endpoint")
						}
						break
					}
					default:
						console.warn(`[OTEL] Unknown metrics exporter type: ${exporterType}`)
				}
			} catch (error) {
				console.error(`[OTEL] Failed to create metrics exporter '${exporterType}':`, error)
			}
		}

		if (readers.length === 0) {
			console.warn("[OTEL] No metric readers were successfully created")
		}

		const meterProvider = new MeterProvider({
			resource,
			readers,
		})

		// Set as global meter provider
		metrics.setGlobalMeterProvider(meterProvider)
		console.log(`[OTEL] MeterProvider initialized with ${readers.length} reader(s)`)

		return meterProvider
	}

	private createLoggerProvider(resource: Resource): LoggerProvider {
		const exporters = this.config!.logsExporter!.split(",").map((type) => type.trim())
		const loggerProvider = new LoggerProvider({ resource })

		console.log(`[OTEL] Creating LoggerProvider with exporters: ${exporters.join(", ")}`)

		for (const exporterType of exporters) {
			try {
				let exporter = null

				switch (exporterType) {
					case "console":
						exporter = createConsoleLogExporter()
						console.log("[OTEL] Console logs exporter created")
						break
					case "otlp": {
						const protocol = this.config!.otlpLogsProtocol || this.config!.otlpProtocol || "grpc"
						const endpoint = this.config!.otlpLogsEndpoint || this.config!.otlpEndpoint
						const insecure = this.config!.otlpInsecure || false

						if (endpoint) {
							exporter = createOTLPLogExporter(protocol, endpoint, insecure)
							if (exporter) {
								console.log(`[OTEL] OTLP logs exporter created (${protocol})`)
							}
						} else {
							console.warn("[OTEL] OTLP logs exporter requires an endpoint")
						}
						break
					}
					default:
						console.warn(`[OTEL] Unknown logs exporter type: ${exporterType}`)
				}

				if (exporter) {
					const batchConfig = {
						maxQueueSize: this.config!.logMaxQueueSize || 2048,
						maxExportBatchSize: this.config!.logBatchSize || 512,
						scheduledDelayMillis: this.config!.logBatchTimeout || 5000,
					}

					loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter, batchConfig))

					console.log(
						`[OTEL] Log batch processor configured: maxQueue=${batchConfig.maxQueueSize}, batchSize=${batchConfig.maxExportBatchSize}, timeout=${batchConfig.scheduledDelayMillis}ms`,
					)
				}
			} catch (error) {
				console.error(`[OTEL] Failed to create logs exporter '${exporterType}':`, error)
			}
		}

		// Set as global logger provider
		logs.setGlobalLoggerProvider(loggerProvider)
		console.log("[OTEL] LoggerProvider initialized")

		return loggerProvider
	}

	public async dispose(): Promise<void> {
		const promises: Promise<void>[] = []

		if (this.meterProvider) {
			promises.push(
				this.meterProvider.shutdown().catch((error) => {
					console.error("Error shutting down MeterProvider:", error)
				}),
			)
		}

		if (this.loggerProvider) {
			promises.push(
				this.loggerProvider.shutdown().catch((error) => {
					console.error("Error shutting down LoggerProvider:", error)
				}),
			)
		}

		await Promise.all(promises)
	}
}
