/**
 * OpenTelemetry Exporter Diagnostic Utilities
 *
 * Provides wrapper functions to add comprehensive diagnostic logging
 * to OTLP exporters for better observability and troubleshooting.
 */

/**
 * Wraps a metrics exporter with enhanced diagnostic logging
 */
export function wrapMetricsExporterWithDiagnostics(exporter: any, protocol: string, endpoint: string): void {
	if (!exporter || typeof exporter.export !== "function") {
		return
	}

	const originalExport = exporter.export.bind(exporter)
	let exportAttemptCount = 0

	exporter.export = (metrics: any, resultCallback: any) => {
		exportAttemptCount++
		const attemptId = exportAttemptCount
		const startTime = Date.now()

		// Extract metrics details
		const metricsData = metrics?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics
		const metricsCount = Array.isArray(metricsData) ? metricsData.length : 0

		console.log(`[OTEL METRICS] 📤 Export attempt #${attemptId} starting at ${new Date().toISOString()}`)
		console.log(`[OTEL METRICS]    → Target: ${endpoint}/v1/metrics`)
		console.log(`[OTEL METRICS]    → Protocol: ${protocol}`)
		console.log(`[OTEL METRICS]    → Metrics count: ${metricsCount}`)
		if (metricsCount > 0) {
			console.log(`[OTEL METRICS]    → Metric names: ${metricsData.map((m: any) => m.name).join(", ")}`)
		}

		// Set up timeout detection (10 seconds for remote collectors)
		let callbackInvoked = false
		const timeoutId = setTimeout(() => {
			if (!callbackInvoked) {
				const elapsed = Date.now() - startTime
				console.error(`[OTEL METRICS] ⏱️  Export attempt #${attemptId} TIMEOUT DETECTED`)
				console.error(`[OTEL METRICS]    → No callback received after ${elapsed}ms`)
				console.error(
					`[OTEL METRICS]    → This suggests the export request is hanging or the callback is not being invoked`,
				)
				console.error(`[OTEL METRICS]    → Check network connectivity to ${endpoint}`)
			}
		}, 10000)

		const wrappedCallback = (result: any) => {
			callbackInvoked = true
			clearTimeout(timeoutId)
			const elapsed = Date.now() - startTime

			if (result.code === 0) {
				// SUCCESS
				console.log(`[OTEL METRICS] ✅ Export attempt #${attemptId} SUCCEEDED in ${elapsed}ms`)
				console.log(`[OTEL METRICS]    → ${metricsCount} metrics successfully sent to ${endpoint}`)
			} else {
				// FAILURE
				logMetricsExportFailure(attemptId, elapsed, endpoint, result)
			}

			resultCallback(result)
		}

		try {
			console.log(`[OTEL METRICS]    → Invoking SDK export method...`)
			originalExport(metrics, wrappedCallback)
			console.log(`[OTEL METRICS]    → SDK export method returned (waiting for callback)`)
		} catch (error) {
			clearTimeout(timeoutId)
			callbackInvoked = true
			const elapsed = Date.now() - startTime
			logMetricsExportException(attemptId, elapsed, error)
			throw error
		}
	}

	console.log("[OTEL METRICS] ✓ Export method wrapped with enhanced diagnostic logging")
}

/**
 * Wraps a logs exporter with enhanced diagnostic logging
 */
export function wrapLogsExporterWithDiagnostics(exporter: any, protocol: string, endpoint: string): void {
	if (!exporter || typeof exporter.export !== "function") {
		return
	}

	const originalExport = exporter.export.bind(exporter)
	let exportAttemptCount = 0

	exporter.export = (logs: any, resultCallback: any) => {
		exportAttemptCount++
		const attemptId = exportAttemptCount
		const startTime = Date.now()

		// Extract logs details
		const logsData = logs?.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords
		const logsCount = Array.isArray(logsData) ? logsData.length : 0

		console.log(`[OTEL LOGS] 📤 Export attempt #${attemptId} starting at ${new Date().toISOString()}`)
		console.log(`[OTEL LOGS]    → Target: ${endpoint}/v1/logs`)
		console.log(`[OTEL LOGS]    → Protocol: ${protocol}`)
		console.log(`[OTEL LOGS]    → Logs count: ${logsCount}`)

		// Set up timeout detection (10 seconds for remote collectors)
		let callbackInvoked = false
		const timeoutId = setTimeout(() => {
			if (!callbackInvoked) {
				const elapsed = Date.now() - startTime
				console.error(`[OTEL LOGS] ⏱️  Export attempt #${attemptId} TIMEOUT DETECTED`)
				console.error(`[OTEL LOGS]    → No callback received after ${elapsed}ms`)
				console.error(`[OTEL LOGS]    → This suggests the export request is hanging or the callback is not being invoked`)
				console.error(`[OTEL LOGS]    → Check network connectivity to ${endpoint}`)
			}
		}, 10000)

		const wrappedCallback = (result: any) => {
			callbackInvoked = true
			clearTimeout(timeoutId)
			const elapsed = Date.now() - startTime

			if (result.code === 0) {
				// SUCCESS
				console.log(`[OTEL LOGS] ✅ Export attempt #${attemptId} SUCCEEDED in ${elapsed}ms`)
				console.log(`[OTEL LOGS]    → ${logsCount} log records successfully sent to ${endpoint}`)
			} else {
				// FAILURE
				logLogsExportFailure(attemptId, elapsed, endpoint, result)
			}

			resultCallback(result)
		}

		try {
			console.log(`[OTEL LOGS]    → Invoking SDK export method...`)
			originalExport(logs, wrappedCallback)
			console.log(`[OTEL LOGS]    → SDK export method returned (waiting for callback)`)
		} catch (error) {
			clearTimeout(timeoutId)
			callbackInvoked = true
			const elapsed = Date.now() - startTime
			logLogsExportException(attemptId, elapsed, error)
			throw error
		}
	}

	console.log("[OTEL LOGS] ✓ Export method wrapped with enhanced diagnostic logging")
}

/**
 * Logs detailed information about a metrics export failure
 */
function logMetricsExportFailure(attemptId: number, elapsed: number, endpoint: string, result: any): void {
	console.error(`[OTEL METRICS] ❌ Export attempt #${attemptId} FAILED after ${elapsed}ms`)
	console.error(`[OTEL METRICS]    → Result code: ${result.code}`)
	console.error(`[OTEL METRICS]    → Error message: ${result.error?.message || "unknown"}`)

	// Extract HTTP status code from various possible locations
	const httpStatus = extractHttpStatusCode(result.error)

	// Log comprehensive error details
	if (result.error) {
		console.error(`[OTEL METRICS]    → Error details:`)
		console.error(`[OTEL METRICS]       • Type: ${result.error.name || typeof result.error}`)
		console.error(`[OTEL METRICS]       • Message: ${result.error.message || "No message"}`)
		if (result.error.code) {
			console.error(`[OTEL METRICS]       • Code: ${result.error.code}`)
		}
		if (httpStatus) {
			console.error(`[OTEL METRICS]       • HTTP Status: ${httpStatus}`)
		}
		if (result.error.details) {
			console.error(`[OTEL METRICS]       • Details: ${JSON.stringify(result.error.details)}`)
		}
		if (result.error.metadata) {
			console.error(`[OTEL METRICS]       • Metadata: ${JSON.stringify(result.error.metadata)}`)
		}
		if (result.error.stack) {
			console.error(`[OTEL METRICS]       • Stack trace (first 5 lines):`)
			result.error.stack
				.split("\n")
				.slice(0, 5)
				.forEach((line: string) => {
					console.error(`[OTEL METRICS]         ${line}`)
				})
		}
		if (result.error.response) {
			console.error(`[OTEL METRICS]       • Response body: ${JSON.stringify(result.error.response).substring(0, 200)}`)
		}
	}

	// Provide diagnostic guidance with HTTP status if available
	provideDiagnosticGuidance("[OTEL METRICS]", endpoint, elapsed, result.error?.message, httpStatus)
}

/**
 * Logs detailed information about a logs export failure
 */
function logLogsExportFailure(attemptId: number, elapsed: number, endpoint: string, result: any): void {
	console.error(`[OTEL LOGS] ❌ Export attempt #${attemptId} FAILED after ${elapsed}ms`)
	console.error(`[OTEL LOGS]    → Result code: ${result.code}`)
	console.error(`[OTEL LOGS]    → Error message: ${result.error?.message || "unknown"}`)

	// Extract HTTP status code from various possible locations
	const httpStatus = extractHttpStatusCode(result.error)

	// Log comprehensive error details
	if (result.error) {
		console.error(`[OTEL LOGS]    → Error details:`)
		console.error(`[OTEL LOGS]       • Type: ${result.error.name || typeof result.error}`)
		console.error(`[OTEL LOGS]       • Message: ${result.error.message || "No message"}`)
		if (result.error.code) {
			console.error(`[OTEL LOGS]       • Code: ${result.error.code}`)
		}
		if (httpStatus) {
			console.error(`[OTEL LOGS]       • HTTP Status: ${httpStatus}`)
		}
		if (result.error.details) {
			console.error(`[OTEL LOGS]       • Details: ${JSON.stringify(result.error.details)}`)
		}
		if (result.error.metadata) {
			console.error(`[OTEL LOGS]       • Metadata: ${JSON.stringify(result.error.metadata)}`)
		}
		if (result.error.stack) {
			console.error(`[OTEL LOGS]       • Stack trace (first 5 lines):`)
			result.error.stack
				.split("\n")
				.slice(0, 5)
				.forEach((line: string) => {
					console.error(`[OTEL LOGS]         ${line}`)
				})
		}
		if (result.error.response) {
			console.error(`[OTEL LOGS]       • Response body: ${JSON.stringify(result.error.response).substring(0, 200)}`)
		}
	}

	// Provide diagnostic guidance with HTTP status if available
	provideDiagnosticGuidance("[OTEL LOGS]", endpoint, elapsed, result.error?.message, httpStatus)
}

/**
 * Logs exception information when export method throws
 */
function logMetricsExportException(attemptId: number, elapsed: number, error: unknown): void {
	console.error(`[OTEL METRICS] ❌ Export attempt #${attemptId} threw exception after ${elapsed}ms:`)
	console.error(`[OTEL METRICS]    → Exception type: ${error instanceof Error ? error.name : typeof error}`)
	console.error(`[OTEL METRICS]    → Exception message: ${error instanceof Error ? error.message : String(error)}`)
	if (error instanceof Error && error.stack) {
		console.error(`[OTEL METRICS]    → Stack trace (first 5 lines):`)
		error.stack
			.split("\n")
			.slice(0, 5)
			.forEach((line) => {
				console.error(`[OTEL METRICS]       ${line}`)
			})
	}
}

/**
 * Logs exception information when export method throws (logs version)
 */
function logLogsExportException(attemptId: number, elapsed: number, error: unknown): void {
	console.error(`[OTEL LOGS] ❌ Export attempt #${attemptId} threw exception after ${elapsed}ms:`)
	console.error(`[OTEL LOGS]    → Exception type: ${error instanceof Error ? error.name : typeof error}`)
	console.error(`[OTEL LOGS]    → Exception message: ${error instanceof Error ? error.message : String(error)}`)
	if (error instanceof Error && error.stack) {
		console.error(`[OTEL LOGS]    → Stack trace (first 5 lines):`)
		error.stack
			.split("\n")
			.slice(0, 5)
			.forEach((line) => {
				console.error(`[OTEL LOGS]       ${line}`)
			})
	}
}

/**
 * Extracts HTTP status code from error object (checks multiple possible locations)
 */
function extractHttpStatusCode(error: any): number | null {
	if (!error) return null

	// Check direct properties
	if (error.statusCode) return error.statusCode
	if (error.status) return error.status
	if (error.code && typeof error.code === "number" && error.code >= 100 && error.code < 600) {
		return error.code
	}

	// Check nested response object
	if (error.response) {
		if (error.response.statusCode) return error.response.statusCode
		if (error.response.status) return error.response.status
	}

	// Check metadata (gRPC style)
	if (error.metadata && typeof error.metadata === "object") {
		const statusHeader = error.metadata["http-status"] || error.metadata["grpc-status"]
		if (statusHeader && typeof statusHeader === "number") return statusHeader
	}

	return null
}

/**
 * Provides specific diagnostic guidance based on error message and HTTP status
 */
function provideDiagnosticGuidance(
	prefix: string,
	endpoint: string,
	elapsed: number,
	errorMessage?: string,
	httpStatus?: number | null,
): void {
	if (!errorMessage && !httpStatus) {
		return
	}

	const msg = (errorMessage || "").toLowerCase()
	console.error(`${prefix}    → Diagnostic guidance:`)

	// Check HTTP status code first (most specific)
	if (httpStatus) {
		provideHttpStatusGuidance(prefix, endpoint, httpStatus, elapsed)
		return
	}

	// Fall back to error message patterns
	if (msg.includes("retryable status") || msg.includes("export failed")) {
		console.error(`${prefix}       • Export failed with retryable status (SDK internal error)`)
		console.error(`${prefix}       • This typically indicates:`)
		console.error(`${prefix}         - HTTP timeout (request took too long, ~${elapsed}ms in this case)`)
		console.error(`${prefix}         - Server returned 5xx error (503 Service Unavailable, etc.)`)
		console.error(`${prefix}         - Server returned 429 Too Many Requests`)
		console.error(`${prefix}         - Network connection issues`)
		console.error(`${prefix}       • Troubleshooting steps:`)
		console.error(`${prefix}         1. Check if ${endpoint} is accessible (try curl/browser)`)
		console.error(`${prefix}         2. Verify collector is healthy and not overloaded`)
		console.error(`${prefix}         3. Check collector logs for errors`)
		console.error(`${prefix}         4. Consider increasing export timeout if network is slow`)
		console.error(`${prefix}         5. Verify bearer token/auth is correct`)
	} else if (msg.includes("econnrefused")) {
		console.error(`${prefix}       • Connection refused - collector not reachable at ${endpoint}`)
		console.error(`${prefix}       • Verify the endpoint URL is correct`)
		console.error(`${prefix}       • Check if the collector service is running`)
	} else if (msg.includes("timeout") || msg.includes("etimedout")) {
		console.error(`${prefix}       • Connection timeout after ${elapsed}ms - network latency or collector overload`)
		console.error(`${prefix}       • Check network connectivity to ${endpoint}`)
		console.error(`${prefix}       • Consider increasing timeout value if network is slow`)
	} else if (msg.includes("unauthorized") || msg.includes("authentication") || msg.includes("401")) {
		console.error(`${prefix}       • Authentication failed (HTTP 401)`)
		console.error(`${prefix}       • Verify OTEL_EXPORTER_OTLP_HEADERS contains correct bearer token`)
		console.error(`${prefix}       • Format: "authorization=Bearer <token>" (check for typos)`)
	} else if (msg.includes("403") || msg.includes("forbidden")) {
		console.error(`${prefix}       • Authorization failed (HTTP 403)`)
		console.error(`${prefix}       • Token is valid but lacks required permissions`)
		console.error(`${prefix}       • Check token permissions on the collector side`)
	} else if (msg.includes("404")) {
		console.error(`${prefix}       • Endpoint not found (HTTP 404)`)
		console.error(`${prefix}       • Verify the URL path is correct`)
		console.error(`${prefix}       • Check collector configuration for correct receivers`)
	} else if (msg.includes("dns") || msg.includes("enotfound") || msg.includes("eai_again")) {
		console.error(`${prefix}       • DNS resolution failed for ${endpoint}`)
		console.error(`${prefix}       • Check hostname spelling`)
		console.error(`${prefix}       • Verify DNS servers are accessible`)
	} else if (msg.includes("certificate") || msg.includes("tls") || msg.includes("ssl") || msg.includes("self-signed")) {
		console.error(`${prefix}       • TLS/SSL certificate error`)
		console.error(`${prefix}       • For testing: set OTEL_EXPORTER_OTLP_INSECURE=true (NOT for production!)`)
		console.error(`${prefix}       • For production: ensure valid SSL certificate`)
	} else if (msg.includes("network") || msg.includes("enetunreach")) {
		console.error(`${prefix}       • Network unreachable`)
		console.error(`${prefix}       • Check internet connectivity`)
		console.error(`${prefix}       • Verify firewall rules allow outbound HTTPS`)
	} else {
		console.error(`${prefix}       • Unknown error type - see details above`)
		console.error(`${prefix}       • For "retryable status" errors, the collector likely returned an HTTP 5xx error`)
		console.error(`${prefix}       • Run: curl -v -X POST ${endpoint}/v1/logs -H "Authorization: Bearer <token>" -d '{}'`)
	}
}

/**
 * Provides specific guidance based on HTTP status code
 */
function provideHttpStatusGuidance(prefix: string, endpoint: string, httpStatus: number, elapsed: number): void {
	if (httpStatus >= 200 && httpStatus < 300) {
		console.error(`${prefix}       • HTTP ${httpStatus} - Success status, but SDK reported as failure`)
		console.error(`${prefix}       • This may be a bug in the SDK or wrapper code`)
		return
	}

	if (httpStatus >= 400 && httpStatus < 500) {
		// Client errors
		switch (httpStatus) {
			case 400:
				console.error(`${prefix}       • HTTP 400 Bad Request - Invalid data format sent to collector`)
				console.error(`${prefix}       • Check OTLP protocol matches collector configuration`)
				console.error(`${prefix}       • Verify data payload structure is correct`)
				break
			case 401:
				console.error(`${prefix}       • HTTP 401 Unauthorized - Authentication failed`)
				console.error(`${prefix}       • Verify OTEL_EXPORTER_OTLP_HEADERS contains correct bearer token`)
				console.error(`${prefix}       • Format: "authorization=Bearer <token>"`)
				console.error(`${prefix}       • Check token hasn't expired`)
				break
			case 403:
				console.error(`${prefix}       • HTTP 403 Forbidden - Authorization failed`)
				console.error(`${prefix}       • Token is valid but lacks required permissions`)
				console.error(`${prefix}       • Check token permissions on the collector/backend`)
				console.error(`${prefix}       • Verify the token is authorized for this endpoint`)
				break
			case 404:
				console.error(`${prefix}       • HTTP 404 Not Found - Endpoint doesn't exist`)
				console.error(`${prefix}       • Verify endpoint URL: ${endpoint}`)
				console.error(`${prefix}       • Check that /v1/metrics or /v1/logs path is correct`)
				console.error(`${prefix}       • Ensure collector has OTLP receiver configured`)
				break
			case 429:
				console.error(`${prefix}       • HTTP 429 Too Many Requests - Rate limit exceeded`)
				console.error(`${prefix}       • Reduce export frequency (increase interval)`)
				console.error(`${prefix}       • Implement exponential backoff`)
				console.error(`${prefix}       • Contact collector admin about rate limits`)
				break
			default:
				console.error(`${prefix}       • HTTP ${httpStatus} - Client error`)
				console.error(`${prefix}       • Check request format and authentication`)
		}
	} else if (httpStatus >= 500 && httpStatus < 600) {
		// Server errors
		switch (httpStatus) {
			case 500:
				console.error(`${prefix}       • HTTP 500 Internal Server Error - Collector backend failure`)
				console.error(`${prefix}       • Collector encountered an unexpected error`)
				console.error(`${prefix}       • Check collector logs for stack traces`)
				console.error(`${prefix}       • Contact collector administrator`)
				break
			case 502:
				console.error(`${prefix}       • HTTP 502 Bad Gateway - Collector backend is down/unreachable`)
				console.error(`${prefix}       • Gateway/proxy can't reach the collector backend`)
				console.error(`${prefix}       • Collector service may be stopped or crashed`)
				console.error(`${prefix}       • Check collector health and restart if needed`)
				console.error(`${prefix}       • Verify backend service configuration`)
				break
			case 503:
				console.error(`${prefix}       • HTTP 503 Service Unavailable - Collector temporarily unavailable`)
				console.error(`${prefix}       • Collector is overloaded or in maintenance`)
				console.error(`${prefix}       • Wait and retry (SDK will retry automatically)`)
				console.error(`${prefix}       • Check collector resource usage (CPU/memory)`)
				break
			case 504:
				console.error(`${prefix}       • HTTP 504 Gateway Timeout - Request took too long (${elapsed}ms)`)
				console.error(`${prefix}       • Gateway timeout waiting for collector response`)
				console.error(`${prefix}       • Collector may be overloaded`)
				console.error(`${prefix}       • Consider increasing timeout or reducing data size`)
				break
			default:
				console.error(`${prefix}       • HTTP ${httpStatus} - Server error`)
				console.error(`${prefix}       • Collector backend is experiencing issues`)
				console.error(`${prefix}       • Check collector logs and health`)
		}
	} else {
		console.error(`${prefix}       • HTTP ${httpStatus} - Unexpected status code`)
	}

	// Common troubleshooting steps for all error codes
	console.error(`${prefix}       • Test connectivity: curl -v ${endpoint}`)
	console.error(`${prefix}       • Check collector logs for more details`)
}
