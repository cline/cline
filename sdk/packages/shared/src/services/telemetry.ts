export type TelemetryPrimitive = string | number | boolean | null | undefined;

export type TelemetryValue =
	| TelemetryPrimitive
	| TelemetryObject
	| TelemetryArray;

export type TelemetryObject = { [key: string]: TelemetryValue };

export type TelemetryArray = Array<TelemetryValue>;

export type TelemetryProperties = TelemetryObject;

const DEFAULT_ERROR_MESSAGE_LIMIT = 500;

export type SdkTelemetryErrorComponent =
	| "shared"
	| "llms"
	| "agents"
	| "core"
	| "cli"
	| "vscode"
	| "desktop"
	| (string & {});

export type SdkTelemetryErrorSeverity =
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "fatal";

export interface CaptureSdkErrorInput {
	component: SdkTelemetryErrorComponent;
	operation: string;
	error: unknown;
	/**
	 * A useful message derived while the caller still has domain-specific error
	 * context. The raw error remains the source of type, code, and status.
	 */
	errorMessage?: string;
	severity?: SdkTelemetryErrorSeverity;
	handled?: boolean;
	context?: TelemetryProperties;
	event?: string;
	messageLimit?: number;
}

export const AGENT_UNEXPECTED_REASONING_TOKENS_EVENT =
	"agent.reasoning.unexpected_tokens";

export interface CaptureAgentUnexpectedReasoningTokensInput {
	sessionId?: string;
	agentId: string;
	runId?: string;
	iteration: number;
	providerId?: string;
	modelId?: string;
	requestedThinking: false;
	reasoningTokenCount: number;
}

export const TASK_PROVIDER_REQUEST_STARTED_EVENT =
	"task.provider_request_started";
export const TASK_PROVIDER_STREAM_STARTED_EVENT =
	"task.provider_stream_started";
export const TASK_FIRST_CHUNK_RECEIVED_EVENT = "task.first_chunk_received";
export const TASK_PROVIDER_STREAM_FAILED_EVENT = "task.provider_stream_failed";
export const TASK_CANCELLED_EVENT = "task.cancelled";
export const TASK_MAX_TOKENS_RECOVERY_EVENT = "task.max_tokens_recovery";

export interface CaptureTaskLifecycleEventInput {
	event: string;
	sessionId?: string;
	ulid?: string;
	agentId?: string;
	conversationId?: string;
	runId?: string;
	iteration?: number;
	providerId?: string;
	modelId?: string;
	phase?: string;
	durationMs?: number;
	eventType?: string;
	error?: unknown;
	/**
	 * Classification of `error` (e.g. context_window_exceeded), emitted as
	 * `error_class` alongside the normalized error fields.
	 */
	errorClass?: string;
	messageLimit?: number;
}

export interface TelemetryMetadata {
	extension_version: string;
	/**
	 * The version of the host-side Cline distribution package: the JetBrains plugin version
	 * (e.g. 1.1.61) on JetBrains, the extension version on VSCode (where it matches
	 * `extension_version`). Absent when the host does not report one.
	 */
	host_plugin_version?: string;
	cline_type: string;
	platform: string;
	platform_version: string;
	os_type: string;
	os_version: string;
	is_dev?: string;
	is_remote_workspace?: boolean;
}

export interface ITelemetryService {
	setDistinctId(distinctId?: string): void;
	setMetadata(metadata: Partial<TelemetryMetadata>): void;
	updateMetadata(metadata: Partial<TelemetryMetadata>): void;
	setCommonProperties(properties: TelemetryProperties): void;
	updateCommonProperties(properties: TelemetryProperties): void;
	isEnabled(): boolean;
	capture(input: { event: string; properties?: TelemetryProperties }): void;
	captureRequired(event: string, properties?: TelemetryProperties): void;
	recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void;
	recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void;
	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void;
	flush(): Promise<void>;
	dispose(): Promise<void>;
}

export const SDK_ERROR_TELEMETRY_EVENT = "sdk.error";

// `sdk.error` is a diagnostic firehose: a process stuck in a retry loop
// (e.g. an unattended agent re-hitting a rate-limited provider) can emit the
// same failure thousands of times and drown the signal. Identical failures
// are therefore capped per process: the first few per hour emit normally,
// the rest are only counted, and the count surfaces as `suppressed_count` on
// the next emission once the window rolls over — a hot loop stays visible
// without flooding. State is in-memory only and the cap never throws.

/** Identical `sdk.error` emissions allowed per key per window. */
export const SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW = 5;
/** Suppression window for identical `sdk.error` emissions. */
export const SDK_ERROR_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
/** Bound on distinct failure keys tracked; the oldest key is evicted. */
const SDK_ERROR_RATE_LIMIT_MAX_TRACKED_KEYS = 512;

interface SdkErrorWindow {
	startMs: number;
	emitted: number;
	suppressed: number;
}

const sdkErrorWindows = new Map<string, SdkErrorWindow>();

/**
 * Clear per-process `sdk.error` rate-limit state (test isolation).
 *
 * @internal Exported only so package test suites can isolate the
 * process-wide suppression state between tests; not a supported runtime API.
 */
export function resetSdkErrorRateLimiterForTests(): void {
	sdkErrorWindows.clear();
}

/**
 * One key per distinct failure. Structured discriminators (`error_status`,
 * `error_code`) participate in the key so an HTTP 429 and an HTTP 401 never
 * share a budget, while the message is normalized (digit runs collapsed,
 * whitespace folded, case-insensitive, bounded) so messages that differ only
 * by counters or ids — `"iteration 14"` vs `"iteration 99"` — coalesce
 * instead of each getting a fresh budget.
 */
function sdkErrorRateLimitKey(
	event: string,
	properties: TelemetryProperties,
): string {
	const message =
		typeof properties.error_message === "string"
			? properties.error_message
			: "";
	return [
		event,
		properties.component,
		properties.operation,
		properties.error_type,
		properties.error_code ?? "",
		properties.error_status ?? "",
		message
			.replace(/\d+/g, "#")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase()
			.slice(0, 256),
	].join("\u0000");
}

function admitSdkError(key: string): { emit: boolean; suppressed: number } {
	const now = Date.now();
	const window = sdkErrorWindows.get(key);
	if (window && now - window.startMs < SDK_ERROR_RATE_LIMIT_WINDOW_MS) {
		if (window.emitted < SDK_ERROR_RATE_LIMIT_MAX_PER_WINDOW) {
			window.emitted += 1;
			return { emit: true, suppressed: 0 };
		}
		window.suppressed += 1;
		return { emit: false, suppressed: window.suppressed };
	}
	// New key or expired window: emit, carrying forward the count of
	// emissions suppressed in the previous window.
	const suppressed = window?.suppressed ?? 0;
	sdkErrorWindows.delete(key);
	if (sdkErrorWindows.size >= SDK_ERROR_RATE_LIMIT_MAX_TRACKED_KEYS) {
		const oldest = sdkErrorWindows.keys().next();
		if (!oldest.done) {
			sdkErrorWindows.delete(oldest.value);
		}
	}
	sdkErrorWindows.set(key, { startMs: now, emitted: 1, suppressed: 0 });
	return { emit: true, suppressed };
}

export function captureAgentUnexpectedReasoningTokens(
	telemetry: ITelemetryService | undefined,
	input: CaptureAgentUnexpectedReasoningTokensInput,
): void {
	telemetry?.capture({
		event: AGENT_UNEXPECTED_REASONING_TOKENS_EVENT,
		properties: stripUndefinedTelemetryProperties({
			sessionId: input.sessionId,
			agentId: input.agentId,
			runId: input.runId,
			iteration: input.iteration,
			providerId: input.providerId,
			modelId: input.modelId,
			requestedThinking: input.requestedThinking,
			reasoningTokenCount: input.reasoningTokenCount,
		}),
	});
}

export function captureTaskLifecycleEvent(
	telemetry: ITelemetryService | undefined,
	input: CaptureTaskLifecycleEventInput,
): void {
	if (!telemetry) {
		return;
	}
	telemetry.capture({
		event: input.event,
		properties: stripUndefinedTelemetryProperties({
			sessionId: input.sessionId,
			ulid: input.ulid ?? input.sessionId,
			agentId: input.agentId,
			conversationId: input.conversationId,
			runId: input.runId,
			iteration: input.iteration,
			provider: input.providerId,
			providerId: input.providerId,
			model: input.modelId,
			modelId: input.modelId,
			phase: input.phase,
			durationMs: input.durationMs,
			eventType: input.eventType,
			...(input.error === undefined
				? {}
				: normalizeSdkError(input.error, input.messageLimit)),
			error_class: input.errorClass,
		}),
	});
}

/**
 * Report an SDK error, subject to the per-process volume cap on identical
 * failures described above.
 *
 * Returns `true` when the failure is recorded — emitted, or counted toward
 * `suppressed_count` by the volume cap — and `false` when telemetry is
 * unavailable. Reporters that sit on a layer boundary forward the return
 * value (see `errorReported` on the model stream's `finish` event) so outer
 * layers know the failure is already accounted for and one underlying
 * failure produces one event, not one per layer it propagates through.
 */
export function captureSdkError(
	telemetry: ITelemetryService | undefined,
	input: CaptureSdkErrorInput,
): boolean {
	if (!telemetry) {
		return false;
	}
	const event = input.event ?? SDK_ERROR_TELEMETRY_EVENT;
	const properties = buildSdkErrorProperties(input);
	let suppressed = 0;
	try {
		const decision = admitSdkError(sdkErrorRateLimitKey(event, properties));
		if (!decision.emit) {
			return true;
		}
		suppressed = decision.suppressed;
	} catch {
		// The volume cap must never block error reporting.
	}
	telemetry.capture({
		event,
		properties:
			suppressed > 0
				? { ...properties, suppressed_count: suppressed }
				: properties,
	});
	return true;
}

export function buildSdkErrorProperties(
	input: CaptureSdkErrorInput,
): TelemetryProperties {
	// Strip undefined values (matching the other capture helpers here) — the
	// OTel adapter would otherwise export them as literal "undefined" strings.
	return stripUndefinedTelemetryProperties({
		...(input.context ?? {}),
		component: input.component,
		operation: input.operation,
		severity: input.severity ?? "error",
		handled: input.handled ?? true,
		...normalizeSdkError(input.error, input.messageLimit, input.errorMessage),
	});
}

function stripUndefinedTelemetryProperties(
	properties: TelemetryProperties,
): TelemetryProperties {
	const result: TelemetryProperties = {};
	for (const [key, value] of Object.entries(properties)) {
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

export function normalizeSdkError(
	error: unknown,
	messageLimit = DEFAULT_ERROR_MESSAGE_LIMIT,
	errorMessage?: string,
): TelemetryProperties {
	const record = isRecord(error) ? error : undefined;
	const errorObject = error instanceof Error ? error : undefined;
	const message =
		stringValue(errorMessage) ??
		stringValue(errorObject?.message) ??
		stringValue(record?.message) ??
		fallbackErrorString(error) ??
		"Unknown error";
	const code = stringOrNumberValue(record?.code);
	const status =
		numberValue(record?.status) ??
		numberValue(record?.statusCode) ??
		numberValue(record?.responseStatus);

	return {
		error_type:
			errorObject?.name?.trim() ||
			stringValue(record?.name) ||
			errorObject?.constructor?.name ||
			"Error",
		error_message: truncateTelemetryString(
			sanitizeTelemetryErrorMessage(message),
			messageLimit,
		),
		...(code !== undefined ? { error_code: code } : {}),
		...(status !== undefined ? { error_status: status } : {}),
	};
}

function sanitizeTelemetryErrorMessage(message: string): string {
	return message
		.replace(/(authorization=Bearer\s+)[^&\s]+/gi, "$1[redacted]")
		.replace(
			/(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)=([^&\s]+)/gi,
			"$1=[redacted]",
		)
		.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
		.replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
		.replace(/\/home\/[^/\s]+/g, "/home/[redacted]")
		.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s]+/g, "$1[redacted]");
}

function truncateTelemetryString(value: string, limit: number): string {
	const normalizedLimit = Math.max(1, Math.floor(limit));
	return value.length > normalizedLimit
		? value.substring(0, normalizedLimit)
		: value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function fallbackErrorString(error: unknown): string | undefined {
	if (error instanceof Error) {
		return undefined;
	}
	const value = typeof error === "string" ? error : String(error);
	return value === "[object Object]" ? undefined : stringValue(value);
}

function stringOrNumberValue(value: unknown): string | number | undefined {
	if (typeof value === "string" && value.trim().length > 0) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export interface OpenTelemetryClientConfig {
	/**
	 * Whether telemetry is enabled via OTEL_TELEMETRY_ENABLED
	 */
	enabled: boolean;

	/**
	 * Metrics exporter type(s) - can be comma-separated for multiple exporters
	 * Examples: "console", "otlp", "console,otlp"
	 */
	metricsExporter?: string;

	/**
	 * Logs/events exporter type(s) - can be comma-separated for multiple exporters
	 * Examples: "console", "otlp"
	 */
	logsExporter?: string;

	/**
	 * Distributed tracing exporter type(s) - comma-separated for multiple exporters.
	 * Examples: "console", "otlp". When unset, no `TracerProvider` is registered.
	 */
	tracesExporter?: string;

	/**
	 * Protocol for OTLP exporters. SDK support is currently limited to "http/json".
	 */
	otlpProtocol?: string;

	/**
	 * General OTLP endpoint (used if specific endpoints not set)
	 */
	otlpEndpoint?: string;

	/**
	 * General OTLP headers
	 */
	otlpHeaders?: Record<string, string>;

	/**
	 * Metrics-specific OTLP protocol
	 */
	otlpMetricsProtocol?: string;

	/**
	 * Metrics-specific OTLP endpoint
	 */
	otlpMetricsEndpoint?: string;

	otlpMetricsHeaders?: Record<string, string>;

	/**
	 * Logs-specific OTLP protocol
	 */
	otlpLogsProtocol?: string;

	/**
	 * Logs-specific OTLP endpoint
	 */
	otlpLogsEndpoint?: string;

	otlpLogsHeaders?: Record<string, string>;

	/**
	 * Traces-specific OTLP protocol (SDK support is currently limited to "http/json")
	 */
	otlpTracesProtocol?: string;

	/**
	 * Traces-specific OTLP endpoint (defaults to {@link otlpEndpoint} when exporting OTLP traces)
	 */
	otlpTracesEndpoint?: string;

	otlpTracesHeaders?: Record<string, string>;

	/**
	 * Metric export interval in milliseconds (for console exporter)
	 */
	metricExportInterval?: number;

	/**
	 * Whether to use insecure (non-TLS) connections for gRPC OTLP exporters
	 * Set to "true" for local development without TLS
	 * Default: false (uses TLS)
	 */
	otlpInsecure?: boolean;

	/**
	 * Maximum batch size for log records (default: 512)
	 */
	logBatchSize?: number;

	/**
	 * Maximum time to wait before exporting logs in milliseconds (default: 5000)
	 */
	logBatchTimeout?: number;

	/**
	 * Maximum queue size for log records (default: 2048)
	 */
	logMaxQueueSize?: number;
}
