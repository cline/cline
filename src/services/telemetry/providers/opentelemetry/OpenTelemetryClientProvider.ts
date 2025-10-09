import { credentials as grpcCredentials } from "@grpc/grpc-js"
import { metrics } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { OTLPLogExporter as OTLPLogExporterGRPC } from "@opentelemetry/exporter-logs-otlp-grpc"
import { OTLPLogExporter as OTLPLogExporterHTTP } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPLogExporter as OTLPLogExporterProto } from "@opentelemetry/exporter-logs-otlp-proto"
import { OTLPMetricExporter as OTLPMetricExporterGRPC } from "@opentelemetry/exporter-metrics-otlp-grpc"
import { OTLPMetricExporter as OTLPMetricExporterHTTP } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPMetricExporter as OTLPMetricExporterProto } from "@opentelemetry/exporter-metrics-otlp-proto"
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus"
import { Resource } from "@opentelemetry/resources"
import { BatchLogRecordProcessor, ConsoleLogRecordExporter, LoggerProvider, LogRecordExporter } from "@opentelemetry/sdk-logs"
import { ConsoleMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { getValidOpenTelemetryConfig, OpenTelemetryClientValidConfig } from "@/shared/services/config/otel-config"

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

	private constructor() {
		this.config = getValidOpenTelemetryConfig()

		if (!this.config) {
			console.log("[OTEL DEBUG] OpenTelemetry is disabled or not configured")
			return
		}

		console.log("[OTEL DEBUG] ========== OpenTelemetry Initialization ==========")
		console.log(`[OTEL DEBUG] Configuration:`)
		console.log(`[OTEL DEBUG]   - Metrics Exporter: ${this.config.metricsExporter || "none"}`)
		console.log(`[OTEL DEBUG]   - Logs Exporter: ${this.config.logsExporter || "none"}`)
		console.log(`[OTEL DEBUG]   - OTLP Protocol: ${this.config.otlpProtocol || "grpc (default)"}`)
		console.log(`[OTEL DEBUG]   - OTLP Endpoint: ${this.config.otlpEndpoint || "not set"}`)
		console.log(`[OTEL DEBUG]   - OTLP Insecure: ${this.config.otlpInsecure || false}`)
		console.log(`[OTEL DEBUG]   - Metric Export Interval: ${this.config.metricExportInterval || 60000}ms`)

		// Check for headers configuration (via environment variable)
		const hasHeaders = !!process.env.OTEL_EXPORTER_OTLP_HEADERS
		console.log(`[OTEL DEBUG]   - OTLP Headers: ${hasHeaders ? "configured" : "not set"}`)
		if (hasHeaders) {
			// Log header keys only (not values for security)
			const headerKeys = process.env
				.OTEL_EXPORTER_OTLP_HEADERS!.split(",")
				.map((pair) => pair.split("=")[0])
				.join(", ")
			console.log(`[OTEL DEBUG]   - Header Keys: ${headerKeys}`)
		}

		console.log("[OTEL DEBUG] ================================================")

		// Create resource with service information
		const resource = new Resource({
			[ATTR_SERVICE_NAME]: "cline",
			[ATTR_SERVICE_VERSION]: process.env.npm_package_version || "unknown",
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

		console.log(`[OTEL DEBUG] Creating MeterProvider with exporters: ${exporters.join(", ")}`)

		for (const exporterType of exporters) {
			try {
				switch (exporterType) {
					case "console": {
						const exporter = new ConsoleMetricExporter()
						const interval = this.config!.metricExportInterval || 60000
						const reader = new PeriodicExportingMetricReader({
							exporter,
							exportIntervalMillis: interval,
						})
						readers.push(reader)
						console.log(`[OTEL DEBUG] Console metrics exporter created (interval: ${interval}ms)`)
						break
					}
					case "otlp": {
						const exporter = this.createOTLPMetricExporter()
						if (exporter) {
							const interval = this.config!.metricExportInterval || 60000
							// Ensure timeout is always less than interval (use 80% of interval, capped at 30 seconds)
							const timeout = Math.min(Math.floor(interval * 0.8), 30000)
							const reader = new PeriodicExportingMetricReader({
								exporter,
								exportIntervalMillis: interval,
								exportTimeoutMillis: timeout,
							})
							readers.push(reader)
							console.log(
								`[OTEL DEBUG] OTLP metrics exporter created (interval: ${interval}ms, timeout: ${timeout}ms)`,
							)
						}
						break
					}
					case "prometheus": {
						const exporter = new PrometheusExporter({}, () => {
							console.log("[OTEL DEBUG] Prometheus scrape endpoint ready")
						})
						readers.push(exporter)
						console.log("[OTEL DEBUG] Prometheus metrics exporter created")
						break
					}
					default:
						console.warn(`[OTEL DEBUG] Unknown metrics exporter type: ${exporterType}`)
				}
			} catch (error) {
				console.error(`[OTEL ERROR] Failed to create metrics exporter '${exporterType}':`, error)
			}
		}

		if (readers.length === 0) {
			console.warn("[OTEL DEBUG] No metric readers were successfully created")
		}

		const meterProvider = new MeterProvider({
			resource,
			readers,
		})

		// Set as global meter provider
		metrics.setGlobalMeterProvider(meterProvider)
		console.log(`[OTEL DEBUG] MeterProvider initialized with ${readers.length} reader(s)`)

		return meterProvider
	}

	private createLoggerProvider(resource: Resource): LoggerProvider {
		const exporters = this.config!.logsExporter!.split(",").map((type) => type.trim())
		const loggerProvider = new LoggerProvider({ resource })

		console.log(`[OTEL DEBUG] Creating LoggerProvider with exporters: ${exporters.join(", ")}`)

		for (const exporterType of exporters) {
			try {
				let exporter: LogRecordExporter | null = null

				switch (exporterType) {
					case "console":
						exporter = new ConsoleLogRecordExporter()
						console.log("[OTEL DEBUG] Console logs exporter created")
						break
					case "otlp":
						exporter = this.createOTLPLogExporter()
						if (exporter) {
							console.log("[OTEL DEBUG] OTLP logs exporter created")
						}
						break
					default:
						console.warn(`[OTEL DEBUG] Unknown logs exporter type: ${exporterType}`)
				}

				if (exporter) {
					loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter))
				}
			} catch (error) {
				console.error(`[OTEL ERROR] Failed to create logs exporter '${exporterType}':`, error)
			}
		}

		// Set as global logger provider
		logs.setGlobalLoggerProvider(loggerProvider)
		console.log("[OTEL DEBUG] LoggerProvider initialized")

		return loggerProvider
	}

	private createOTLPMetricExporter() {
		const protocol = this.config!.otlpMetricsProtocol || this.config!.otlpProtocol || "grpc"
		const endpoint = this.config!.otlpMetricsEndpoint || this.config!.otlpEndpoint
		const useInsecure = this.config!.otlpInsecure || false

		if (!endpoint) {
			console.warn("[OTEL METRICS] ❌ OTLP metrics exporter requires an endpoint")
			return null
		}

		console.log("[OTEL METRICS] ========== Metrics Exporter Configuration ==========")
		console.log(`[OTEL METRICS] Protocol: ${protocol}`)
		console.log(`[OTEL METRICS] Endpoint: ${endpoint}`)
		console.log(`[OTEL METRICS] Insecure: ${useInsecure}`)
		console.log(`[OTEL METRICS] Headers from env: ${process.env.OTEL_EXPORTER_OTLP_HEADERS ? "YES" : "NO"}`)
		console.log("[OTEL METRICS] =======================================================")

		try {
			let exporter: any = null

			switch (protocol) {
				case "grpc": {
					// For gRPC, strip http:// or https:// prefix if present
					// gRPC endpoints should be in format "localhost:4317" not "http://localhost:4317"
					const grpcEndpoint = endpoint.replace(/^https?:\/\//, "")

					// Configure credentials based on insecure flag
					const credentials = useInsecure ? grpcCredentials.createInsecure() : grpcCredentials.createSsl()

					console.log(
						`[OTEL METRICS] ✓ Using ${useInsecure ? "INSECURE" : "SECURE"} gRPC connection to ${grpcEndpoint}`,
					)

					// Check for stripped prefix and warn if found
					if (endpoint !== grpcEndpoint) {
						console.log(`[OTEL METRICS] ⚠️  Stripped HTTP(S) prefix from endpoint: "${endpoint}" -> "${grpcEndpoint}"`)
					}

					exporter = new OTLPMetricExporterGRPC({
						url: grpcEndpoint,
						credentials: credentials,
					})

					console.log("[OTEL METRICS] ✓ gRPC metrics exporter instance created successfully")
					break
				}
				case "http/json": {
					// For HTTP exporters, we need to append the signal-specific path
					// The SDK only auto-appends paths when using environment variables,
					// not when passing url directly to constructor
					const metricsUrl = endpoint.endsWith("/v1/metrics") ? endpoint : `${endpoint}/v1/metrics`
					console.log(`[OTEL METRICS] ✓ Creating HTTP/JSON exporter for ${metricsUrl}`)
					exporter = new OTLPMetricExporterHTTP({ url: metricsUrl })
					console.log("[OTEL METRICS] ✓ HTTP/JSON metrics exporter instance created successfully")
					break
				}
				case "http/protobuf": {
					// For HTTP exporters, we need to append the signal-specific path
					const metricsUrl = endpoint.endsWith("/v1/metrics") ? endpoint : `${endpoint}/v1/metrics`
					console.log(`[OTEL METRICS] ✓ Creating HTTP/Protobuf exporter for ${metricsUrl}`)
					exporter = new OTLPMetricExporterProto({ url: metricsUrl })
					console.log("[OTEL METRICS] ✓ HTTP/Protobuf metrics exporter instance created successfully")
					break
				}
				default:
					console.warn(`[OTEL METRICS] ❌ Unknown OTLP protocol: ${protocol}`)
					return null
			}

			// Wrap the exporter's export method to add logging
			if (exporter && typeof exporter.export === "function") {
				const originalExport = exporter.export.bind(exporter)
				let exportAttemptCount = 0

				exporter.export = (metrics: any, resultCallback: any) => {
					exportAttemptCount++
					const attemptId = exportAttemptCount

					console.log(`[OTEL METRICS] 📤 Export attempt #${attemptId} starting...`)
					console.log(`[OTEL METRICS]    → Target: ${protocol}://${endpoint}`)
					console.log(
						`[OTEL METRICS]    → Metrics count: ${metrics?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.length || "unknown"}`,
					)

					const wrappedCallback = (result: any) => {
						if (result.code === 0) {
							// SUCCESS
							console.log(`[OTEL METRICS] ✅ Export attempt #${attemptId} SUCCEEDED`)
							console.log(`[OTEL METRICS]    → Data successfully sent to ${endpoint}`)
						} else {
							// FAILURE
							console.error(`[OTEL METRICS] ❌ Export attempt #${attemptId} FAILED`)
							console.error(`[OTEL METRICS]    → Error code: ${result.code}`)
							console.error(`[OTEL METRICS]    → Error message: ${result.error?.message || "unknown"}`)

							// Log additional error details
							if (result.error) {
								console.error(`[OTEL METRICS]    → Error details:`, {
									name: result.error.name,
									message: result.error.message,
									code: result.error.code,
									details: result.error.details,
									metadata: result.error.metadata,
									stack: result.error.stack?.split("\n").slice(0, 3).join("\n"), // First 3 lines of stack
								})
							}

							// Check for common connection issues
							if (result.error?.message) {
								const msg = result.error.message.toLowerCase()
								if (msg.includes("econnrefused")) {
									console.error(
										`[OTEL METRICS]    → ⚠️  Connection refused - is the collector running at ${endpoint}?`,
									)
								} else if (msg.includes("timeout")) {
									console.error(
										`[OTEL METRICS]    → ⚠️  Connection timeout - check network connectivity and collector availability`,
									)
								} else if (
									msg.includes("unauthorized") ||
									msg.includes("authentication") ||
									msg.includes("401")
								) {
									console.error(
										`[OTEL METRICS]    → ⚠️  Authentication failed - check OTEL_EXPORTER_OTLP_HEADERS`,
									)
								} else if (msg.includes("403") || msg.includes("forbidden")) {
									console.error(`[OTEL METRICS]    → ⚠️  Authorization failed - check API key/token permissions`)
								} else if (msg.includes("dns") || msg.includes("enotfound")) {
									console.error(`[OTEL METRICS]    → ⚠️  DNS resolution failed - check endpoint hostname`)
								} else if (msg.includes("certificate") || msg.includes("tls") || msg.includes("ssl")) {
									console.error(
										`[OTEL METRICS]    → ⚠️  TLS/SSL error - check certificate validity or use insecure mode for testing`,
									)
								}
							}
						}

						resultCallback(result)
					}

					try {
						originalExport(metrics, wrappedCallback)
					} catch (error) {
						console.error(`[OTEL METRICS] ❌ Export attempt #${attemptId} threw exception:`, error)
						throw error
					}
				}

				console.log("[OTEL METRICS] ✓ Export method wrapped with diagnostic logging")
			}

			return exporter
		} catch (error) {
			console.error("[OTEL METRICS] ❌ FATAL: Error creating OTLP metrics exporter:", error)
			console.error("[OTEL METRICS]    → Exception details:", {
				name: error instanceof Error ? error.name : typeof error,
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : undefined,
			})
			return null
		}
	}

	private createOTLPLogExporter(): LogRecordExporter | null {
		const protocol = this.config!.otlpLogsProtocol || this.config!.otlpProtocol || "grpc"
		const endpoint = this.config!.otlpLogsEndpoint || this.config!.otlpEndpoint
		const useInsecure = this.config!.otlpInsecure || false

		if (!endpoint) {
			console.warn("[OTEL LOGS] ❌ OTLP logs exporter requires an endpoint")
			return null
		}

		console.log("[OTEL LOGS] ========== Logs Exporter Configuration ==========")
		console.log(`[OTEL LOGS] Protocol: ${protocol}`)
		console.log(`[OTEL LOGS] Endpoint: ${endpoint}`)
		console.log(`[OTEL LOGS] Insecure: ${useInsecure}`)
		console.log(`[OTEL LOGS] Headers from env: ${process.env.OTEL_EXPORTER_OTLP_HEADERS ? "YES" : "NO"}`)
		console.log("[OTEL LOGS] =======================================================")

		try {
			let exporter: any = null

			switch (protocol) {
				case "grpc": {
					const grpcEndpoint = endpoint.replace(/^https?:\/\//, "")
					const credentials = useInsecure ? grpcCredentials.createInsecure() : grpcCredentials.createSsl()

					console.log(
						`[OTEL LOGS] ✓ Using ${useInsecure ? "INSECURE" : "SECURE"} gRPC connection for logs to ${grpcEndpoint}`,
					)

					// Check for stripped prefix and warn if found
					if (endpoint !== grpcEndpoint) {
						console.log(`[OTEL LOGS] ⚠️  Stripped HTTP(S) prefix from endpoint: "${endpoint}" -> "${grpcEndpoint}"`)
					}

					exporter = new OTLPLogExporterGRPC({
						url: grpcEndpoint,
						credentials: credentials,
					})

					console.log("[OTEL LOGS] ✓ gRPC logs exporter instance created successfully")
					break
				}
				case "http/json": {
					// For HTTP exporters, we need to append the signal-specific path
					// The SDK only auto-appends paths when using environment variables,
					// not when passing url directly to constructor
					const logsUrl = endpoint.endsWith("/v1/logs") ? endpoint : `${endpoint}/v1/logs`
					console.log(`[OTEL LOGS] ✓ Creating HTTP/JSON exporter for ${logsUrl}`)
					exporter = new OTLPLogExporterHTTP({ url: logsUrl })
					console.log("[OTEL LOGS] ✓ HTTP/JSON logs exporter instance created successfully")
					break
				}
				case "http/protobuf": {
					// For HTTP exporters, we need to append the signal-specific path
					const logsUrl = endpoint.endsWith("/v1/logs") ? endpoint : `${endpoint}/v1/logs`
					console.log(`[OTEL LOGS] ✓ Creating HTTP/Protobuf exporter for ${logsUrl}`)
					exporter = new OTLPLogExporterProto({ url: logsUrl })
					console.log("[OTEL LOGS] ✓ HTTP/Protobuf logs exporter instance created successfully")
					break
				}
				default:
					console.warn(`[OTEL LOGS] ❌ Unknown OTLP protocol: ${protocol}`)
					return null
			}

			// Wrap the exporter's export method to add logging
			if (exporter && typeof exporter.export === "function") {
				const originalExport = exporter.export.bind(exporter)
				let exportAttemptCount = 0

				exporter.export = (logs: any, resultCallback: any) => {
					exportAttemptCount++
					const attemptId = exportAttemptCount

					console.log(`[OTEL LOGS] 📤 Export attempt #${attemptId} starting...`)
					console.log(`[OTEL LOGS]    → Target: ${protocol}://${endpoint}`)
					console.log(
						`[OTEL LOGS]    → Logs count: ${logs?.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.length || "unknown"}`,
					)

					const wrappedCallback = (result: any) => {
						if (result.code === 0) {
							// SUCCESS
							console.log(`[OTEL LOGS] ✅ Export attempt #${attemptId} SUCCEEDED`)
							console.log(`[OTEL LOGS]    → Data successfully sent to ${endpoint}`)
						} else {
							// FAILURE
							console.error(`[OTEL LOGS] ❌ Export attempt #${attemptId} FAILED`)
							console.error(`[OTEL LOGS]    → Error code: ${result.code}`)
							console.error(`[OTEL LOGS]    → Error message: ${result.error?.message || "unknown"}`)

							// Log additional error details
							if (result.error) {
								console.error(`[OTEL LOGS]    → Error details:`, {
									name: result.error.name,
									message: result.error.message,
									code: result.error.code,
									details: result.error.details,
									metadata: result.error.metadata,
									stack: result.error.stack?.split("\n").slice(0, 3).join("\n"), // First 3 lines of stack
								})
							}

							// Check for common connection issues
							if (result.error?.message) {
								const msg = result.error.message.toLowerCase()
								if (msg.includes("econnrefused")) {
									console.error(
										`[OTEL LOGS]    → ⚠️  Connection refused - is the collector running at ${endpoint}?`,
									)
								} else if (msg.includes("timeout")) {
									console.error(
										`[OTEL LOGS]    → ⚠️  Connection timeout - check network connectivity and collector availability`,
									)
								} else if (
									msg.includes("unauthorized") ||
									msg.includes("authentication") ||
									msg.includes("401")
								) {
									console.error(`[OTEL LOGS]    → ⚠️  Authentication failed - check OTEL_EXPORTER_OTLP_HEADERS`)
								} else if (msg.includes("403") || msg.includes("forbidden")) {
									console.error(`[OTEL LOGS]    → ⚠️  Authorization failed - check API key/token permissions`)
								} else if (msg.includes("dns") || msg.includes("enotfound")) {
									console.error(`[OTEL LOGS]    → ⚠️  DNS resolution failed - check endpoint hostname`)
								} else if (msg.includes("certificate") || msg.includes("tls") || msg.includes("ssl")) {
									console.error(
										`[OTEL LOGS]    → ⚠️  TLS/SSL error - check certificate validity or use insecure mode for testing`,
									)
								}
							}
						}

						resultCallback(result)
					}

					try {
						originalExport(logs, wrappedCallback)
					} catch (error) {
						console.error(`[OTEL LOGS] ❌ Export attempt #${attemptId} threw exception:`, error)
						throw error
					}
				}

				console.log("[OTEL LOGS] ✓ Export method wrapped with diagnostic logging")
			}

			return exporter
		} catch (error) {
			console.error("[OTEL LOGS] ❌ FATAL: Error creating OTLP logs exporter:", error)
			console.error("[OTEL LOGS]    → Exception details:", {
				name: error instanceof Error ? error.name : typeof error,
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : undefined,
			})
			return null
		}
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
