export type TelemetryPrimitive = string | number | boolean | null | undefined;

export type TelemetryValue =
	| TelemetryPrimitive
	| TelemetryObject
	| TelemetryArray;

export type TelemetryObject = { [key: string]: TelemetryValue };

export type TelemetryArray = Array<TelemetryValue>;

export type TelemetryProperties = TelemetryObject;

export interface TelemetryMetadata {
	extension_version: string;
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
