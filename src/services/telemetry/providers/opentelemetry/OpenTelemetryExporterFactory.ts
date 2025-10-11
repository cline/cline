import { credentials as grpcCredentials } from "@grpc/grpc-js"
import { OTLPLogExporter as OTLPLogExporterGRPC } from "@opentelemetry/exporter-logs-otlp-grpc"
import { OTLPLogExporter as OTLPLogExporterHTTP } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPLogExporter as OTLPLogExporterProto } from "@opentelemetry/exporter-logs-otlp-proto"
import { OTLPMetricExporter as OTLPMetricExporterGRPC } from "@opentelemetry/exporter-metrics-otlp-grpc"
import { OTLPMetricExporter as OTLPMetricExporterHTTP } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPMetricExporter as OTLPMetricExporterProto } from "@opentelemetry/exporter-metrics-otlp-proto"
import { ConsoleLogRecordExporter, LogRecordExporter } from "@opentelemetry/sdk-logs"
import { ConsoleMetricExporter, MetricReader, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { wrapLogsExporterWithDiagnostics, wrapMetricsExporterWithDiagnostics } from "./otel-exporter-diagnostics"

/**
 * Check if debug diagnostics are enabled
 */
function isDebugEnabled(): boolean {
	return process.env.TEL_DEBUG_DIAGNOSTICS === "true" || process.env.IS_DEV === "true"
}

/**
 * Create a console log exporter
 */
export function createConsoleLogExporter(): ConsoleLogRecordExporter {
	return new ConsoleLogRecordExporter()
}

/**
 * Create an OTLP log exporter based on protocol
 */
export function createOTLPLogExporter(protocol: string, endpoint: string, insecure: boolean): LogRecordExporter | null {
	try {
		let exporter: any = null

		switch (protocol) {
			case "grpc": {
				const grpcEndpoint = endpoint.replace(/^https?:\/\//, "")
				const credentials = insecure ? grpcCredentials.createInsecure() : grpcCredentials.createSsl()

				exporter = new OTLPLogExporterGRPC({
					url: grpcEndpoint,
					credentials: credentials,
				})
				break
			}
			case "http/json": {
				const logsUrl = endpoint.endsWith("/v1/logs") ? endpoint : `${endpoint}/v1/logs`
				exporter = new OTLPLogExporterHTTP({ url: logsUrl })
				break
			}
			case "http/protobuf": {
				const logsUrl = endpoint.endsWith("/v1/logs") ? endpoint : `${endpoint}/v1/logs`
				exporter = new OTLPLogExporterProto({ url: logsUrl })
				break
			}
			default:
				console.warn(`[OTEL] Unknown OTLP protocol for logs: ${protocol}`)
				return null
		}

		// Wrap with diagnostics if debug is enabled
		if (isDebugEnabled()) {
			wrapLogsExporterWithDiagnostics(exporter, protocol, endpoint)
		}

		return exporter
	} catch (error) {
		console.error("[OTEL] Error creating OTLP log exporter:", error)
		return null
	}
}

/**
 * Create a console metric reader with exporter
 */
export function createConsoleMetricReader(intervalMs: number, timeoutMs: number): MetricReader {
	const exporter = new ConsoleMetricExporter()
	return new PeriodicExportingMetricReader({
		exporter,
		exportIntervalMillis: intervalMs,
		exportTimeoutMillis: timeoutMs,
	})
}

/**
 * Create an OTLP metric reader with exporter based on protocol
 */
export function createOTLPMetricReader(
	protocol: string,
	endpoint: string,
	insecure: boolean,
	intervalMs: number,
	timeoutMs: number,
): MetricReader | null {
	try {
		let exporter: any = null

		switch (protocol) {
			case "grpc": {
				const grpcEndpoint = endpoint.replace(/^https?:\/\//, "")
				const credentials = insecure ? grpcCredentials.createInsecure() : grpcCredentials.createSsl()

				exporter = new OTLPMetricExporterGRPC({
					url: grpcEndpoint,
					credentials: credentials,
				})
				break
			}
			case "http/json": {
				const metricsUrl = endpoint.endsWith("/v1/metrics") ? endpoint : `${endpoint}/v1/metrics`
				exporter = new OTLPMetricExporterHTTP({ url: metricsUrl })
				break
			}
			case "http/protobuf": {
				const metricsUrl = endpoint.endsWith("/v1/metrics") ? endpoint : `${endpoint}/v1/metrics`
				exporter = new OTLPMetricExporterProto({ url: metricsUrl })
				break
			}
			default:
				console.warn(`[OTEL] Unknown OTLP protocol for metrics: ${protocol}`)
				return null
		}

		// Wrap with diagnostics if debug is enabled
		if (isDebugEnabled()) {
			wrapMetricsExporterWithDiagnostics(exporter, protocol, endpoint)
		}

		return new PeriodicExportingMetricReader({
			exporter,
			exportIntervalMillis: intervalMs,
			exportTimeoutMillis: timeoutMs,
		})
	} catch (error) {
		console.error("[OTEL] Error creating OTLP metric reader:", error)
		return null
	}
}
