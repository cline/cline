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
		}),
	});
}

export function captureSdkError(
	telemetry: ITelemetryService | undefined,
	input: CaptureSdkErrorInput,
): void {
	if (!telemetry) {
		return;
	}
	telemetry.capture({
		event: input.event ?? SDK_ERROR_TELEMETRY_EVENT,
		properties: buildSdkErrorProperties(input),
	});
}

export function buildSdkErrorProperties(
	input: CaptureSdkErrorInput,
): TelemetryProperties {
	return {
		...(input.context ?? {}),
		component: input.component,
		operation: input.operation,
		severity: input.severity ?? "error",
		handled: input.handled ?? true,
		...normalizeSdkError(input.error, input.messageLimit),
	};
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
): TelemetryProperties {
	const record = isRecord(error) ? error : undefined;
	const errorObject = error instanceof Error ? error : undefined;
	const message =
		errorObject?.message ??
		stringValue(record?.message) ??
		(typeof error === "string" ? error : String(error));
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
	 * Examples: "console", "otlp", "prometheus", "console,otlp"
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
