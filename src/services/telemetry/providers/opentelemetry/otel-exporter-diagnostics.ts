/**
 * OpenTelemetry Exporter Diagnostic Utilities
 *
 * Provides minimal diagnostic logging for OTLP exporters when debug mode is enabled.
 * Enable with: TEL_DEBUG_DIAGNOSTICS=true or IS_DEV=true
 */

/**
 * Wraps a metrics exporter with minimal diagnostic logging
 */
export function wrapMetricsExporterWithDiagnostics(exporter: any, protocol: string, endpoint: string): void {
	if (!exporter || typeof exporter.export !== "function") {
		return
	}

	const originalExport = exporter.export.bind(exporter)
	let exportCount = 0

	exporter.export = (metrics: any, resultCallback: any) => {
		exportCount++
		const startTime = Date.now()

		const wrappedCallback = (result: any) => {
			const elapsed = Date.now() - startTime
			const metricsCount = metrics?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.length || 0

			if (result.code === 0) {
				console.log(
					`[OTEL METRICS] Export #${exportCount} OK - protocol=${protocol} url=${endpoint} count=${metricsCount} elapsed=${elapsed}ms`,
				)
			} else {
				console.error(
					`[OTEL METRICS] Export #${exportCount} FAILED - protocol=${protocol} url=${endpoint} elapsed=${elapsed}ms error="${result.error?.message || "unknown"}"`,
				)
			}

			resultCallback(result)
		}

		try {
			originalExport(metrics, wrappedCallback)
		} catch (error) {
			const elapsed = Date.now() - startTime
			console.error(
				`[OTEL METRICS] Export #${exportCount} EXCEPTION - elapsed=${elapsed}ms error="${error instanceof Error ? error.message : String(error)}"`,
			)
			throw error
		}
	}
}

/**
 * Wraps a logs exporter with minimal diagnostic logging
 */
export function wrapLogsExporterWithDiagnostics(exporter: any, protocol: string, endpoint: string): void {
	if (!exporter || typeof exporter.export !== "function") {
		return
	}

	const originalExport = exporter.export.bind(exporter)
	let exportCount = 0

	exporter.export = (logs: any, resultCallback: any) => {
		exportCount++
		const startTime = Date.now()

		const wrappedCallback = (result: any) => {
			const elapsed = Date.now() - startTime
			const logsCount = logs?.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.length || 0

			if (result.code === 0) {
				console.log(
					`[OTEL LOGS] Export #${exportCount} OK - protocol=${protocol} url=${endpoint} count=${logsCount} elapsed=${elapsed}ms`,
				)
			} else {
				console.error(
					`[OTEL LOGS] Export #${exportCount} FAILED - protocol=${protocol} url=${endpoint} elapsed=${elapsed}ms error="${result.error?.message || "unknown"}"`,
				)
			}

			resultCallback(result)
		}

		try {
			originalExport(logs, wrappedCallback)
		} catch (error) {
			const elapsed = Date.now() - startTime
			console.error(
				`[OTEL LOGS] Export #${exportCount} EXCEPTION - elapsed=${elapsed}ms error="${error instanceof Error ? error.message : String(error)}"`,
			)
			throw error
		}
	}
}
