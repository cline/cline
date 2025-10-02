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
			return
		}

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
	}

	private createMeterProvider(resource: Resource): MeterProvider {
		const exporters = this.config!.metricsExporter!.split(",").map((type) => type.trim())
		const readers: any[] = []

		for (const exporterType of exporters) {
			switch (exporterType) {
				case "console": {
					const exporter = new ConsoleMetricExporter()
					const reader = new PeriodicExportingMetricReader({
						exporter,
						exportIntervalMillis: this.config!.metricExportInterval || 60000,
					})
					readers.push(reader)
					break
				}
				case "otlp": {
					const exporter = this.createOTLPMetricExporter()
					if (exporter) {
						const reader = new PeriodicExportingMetricReader({
							exporter,
							exportIntervalMillis: this.config!.metricExportInterval || 60000,
						})
						readers.push(reader)
					}
					break
				}
				case "prometheus": {
					const exporter = new PrometheusExporter({}, () => {
						console.log("Prometheus scrape endpoint ready")
					})
					readers.push(exporter)
					break
				}
				default:
					console.warn(`Unknown metrics exporter type: ${exporterType}`)
			}
		}

		const meterProvider = new MeterProvider({
			resource,
			readers,
		})

		// Set as global meter provider
		metrics.setGlobalMeterProvider(meterProvider)

		return meterProvider
	}

	private createLoggerProvider(resource: Resource): LoggerProvider {
		const exporters = this.config!.logsExporter!.split(",").map((type) => type.trim())
		const loggerProvider = new LoggerProvider({ resource })

		for (const exporterType of exporters) {
			let exporter: LogRecordExporter | null = null

			switch (exporterType) {
				case "console":
					exporter = new ConsoleLogRecordExporter()
					break
				case "otlp":
					exporter = this.createOTLPLogExporter()
					break
				default:
					console.warn(`Unknown logs exporter type: ${exporterType}`)
			}

			if (exporter) {
				loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter))
			}
		}

		// Set as global logger provider
		logs.setGlobalLoggerProvider(loggerProvider)

		return loggerProvider
	}

	private createOTLPMetricExporter() {
		const protocol = this.config!.otlpMetricsProtocol || this.config!.otlpProtocol || "grpc"
		const endpoint = this.config!.otlpMetricsEndpoint || this.config!.otlpEndpoint

		if (!endpoint) {
			console.warn("OTLP metrics exporter requires an endpoint")
			return null
		}

		switch (protocol) {
			case "grpc":
				return new OTLPMetricExporterGRPC({ url: endpoint })
			case "http/json":
				return new OTLPMetricExporterHTTP({ url: endpoint })
			case "http/protobuf":
				return new OTLPMetricExporterProto({ url: endpoint })
			default:
				console.warn(`Unknown OTLP protocol: ${protocol}`)
				return null
		}
	}

	private createOTLPLogExporter(): LogRecordExporter | null {
		const protocol = this.config!.otlpLogsProtocol || this.config!.otlpProtocol || "grpc"
		const endpoint = this.config!.otlpLogsEndpoint || this.config!.otlpEndpoint

		if (!endpoint) {
			console.warn("OTLP logs exporter requires an endpoint")
			return null
		}

		switch (protocol) {
			case "grpc":
				return new OTLPLogExporterGRPC({ url: endpoint })
			case "http/json":
				return new OTLPLogExporterHTTP({ url: endpoint })
			case "http/protobuf":
				return new OTLPLogExporterProto({ url: endpoint })
			default:
				console.warn(`Unknown OTLP protocol: ${protocol}`)
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
