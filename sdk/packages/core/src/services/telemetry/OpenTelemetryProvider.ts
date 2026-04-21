import type {
	BasicLogger,
	ITelemetryService,
	OpenTelemetryClientConfig,
	TelemetryMetadata,
} from "@clinebot/shared";
import { metrics, type Tracer, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter as OTLPLogExporterHttp } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter as OTLPMetricExporterHttp } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	ConsoleLogRecordExporter,
	LoggerProvider,
	type LogRecordExporter,
} from "@opentelemetry/sdk-logs";
import {
	ConsoleMetricExporter,
	MeterProvider,
	type MetricReader,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
	BatchSpanProcessor,
	ConsoleSpanExporter,
	SimpleSpanProcessor,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { resolveCoreDistinctId } from "./distinct-id";
import {
	OpenTelemetryAdapter,
	type OpenTelemetryAdapterOptions,
} from "./OpenTelemetryAdapter";
import { TelemetryService } from "./TelemetryService";

type OpenTelemetryExporterKind = "console" | "otlp";
type OpenTelemetryProtocol = "http/json";

export interface OpenTelemetryProviderOptions
	extends Omit<
		OpenTelemetryClientConfig,
		"enabled" | "logsExporter" | "metricsExporter" | "tracesExporter"
	> {
	serviceName?: string;
	serviceVersion?: string;
	enabled?: boolean;
	logsExporter?: string | OpenTelemetryExporterKind[];
	metricsExporter?: string | OpenTelemetryExporterKind[];
	tracesExporter?: string | OpenTelemetryExporterKind[];
	metricExportIntervalMs?: number;
	logMaxQueueSize?: number;
	logBatchSize?: number;
	logBatchTimeoutMs?: number;
}

export interface CreateOpenTelemetryTelemetryServiceOptions
	extends OpenTelemetryProviderOptions,
		Pick<
			OpenTelemetryAdapterOptions,
			"name" | "distinctId" | "commonProperties"
		> {
	metadata: TelemetryMetadata;
	logger?: BasicLogger;
}

export class OpenTelemetryProvider {
	readonly meterProvider: MeterProvider | null;
	readonly loggerProvider: LoggerProvider | null;
	readonly tracerProvider: NodeTracerProvider | null;
	private readonly options: OpenTelemetryProviderOptions;

	constructor(options: OpenTelemetryProviderOptions = {}) {
		this.options = options;
		const resource = resourceFromAttributes({
			[ATTR_SERVICE_NAME]: options.serviceName ?? "cline",
			...(options.serviceVersion
				? { [ATTR_SERVICE_VERSION]: options.serviceVersion }
				: {}),
		});

		this.meterProvider = this.createMeterProvider(resource);
		this.loggerProvider = this.createLoggerProvider(resource);
		this.tracerProvider = this.createTracerProvider(resource);

		if (this.meterProvider) {
			metrics.setGlobalMeterProvider(this.meterProvider);
		}
		if (this.loggerProvider) {
			logs.setGlobalLoggerProvider(this.loggerProvider);
		}
		if (this.tracerProvider) {
			this.tracerProvider.register();
		}
	}

	/**
	 * Returns a tracer for manual spans. Requires {@link OpenTelemetryProviderOptions.tracesExporter}
	 * so that a {@link NodeTracerProvider} is registered.
	 */
	getTracer(name = "cline", version?: string): Tracer {
		return trace.getTracer(name, version ?? this.options.serviceVersion);
	}

	createAdapter(
		options: Omit<
			OpenTelemetryAdapterOptions,
			"meterProvider" | "loggerProvider"
		>,
	): OpenTelemetryAdapter {
		return new OpenTelemetryAdapter({
			...options,
			meterProvider: this.meterProvider,
			loggerProvider: this.loggerProvider,
		});
	}

	createTelemetryService(
		options: Omit<
			CreateOpenTelemetryTelemetryServiceOptions,
			keyof OpenTelemetryProviderOptions
		>,
	): ITelemetryService {
		const adapter = this.createAdapter({
			name: options.name,
			enabled: this.options.enabled,
			metadata: options.metadata,
		});
		return new TelemetryService({
			...options,
			adapters: [adapter],
			distinctId: resolveCoreDistinctId(options.distinctId),
		});
	}

	async forceFlush(): Promise<void> {
		await Promise.all([
			this.meterProvider?.forceFlush?.(),
			this.loggerProvider?.forceFlush?.(),
			this.tracerProvider?.forceFlush?.(),
		]);
	}

	async dispose(): Promise<void> {
		await Promise.all([
			this.meterProvider?.shutdown?.(),
			this.loggerProvider?.shutdown?.(),
			this.tracerProvider?.shutdown?.(),
		]);
	}

	private createMeterProvider(
		resource: ReturnType<typeof resourceFromAttributes>,
	): MeterProvider | null {
		const exporters = normalizeExporters(this.options.metricsExporter);
		if (exporters.length === 0) {
			return null;
		}

		const interval = Math.max(
			1_000,
			this.options.metricExportIntervalMs ??
				this.options.metricExportInterval ??
				60_000,
		);
		const timeout = Math.min(30_000, Math.floor(interval * 0.8));
		const readers = exporters
			.map((exporter) =>
				createMetricReader(exporter, {
					endpoint: this.options.otlpEndpoint,
					headers: this.options.otlpHeaders,
					insecure: this.options.otlpInsecure ?? false,
					protocol: "http/json",
					interval,
					timeout,
				}),
			)
			.filter((reader): reader is MetricReader => reader !== null);

		if (readers.length === 0) {
			return null;
		}

		return new MeterProvider({
			resource,
			readers,
		});
	}

	private createTracerProvider(
		resource: ReturnType<typeof resourceFromAttributes>,
	): NodeTracerProvider | null {
		const exporters = normalizeExporters(this.options.tracesExporter);
		if (exporters.length === 0) {
			return null;
		}

		const traceEndpoint =
			this.options.otlpTracesEndpoint ?? this.options.otlpEndpoint;
		const traceHeaders =
			this.options.otlpTracesHeaders ?? this.options.otlpHeaders;

		const processors: SpanProcessor[] = [];
		for (const exporter of exporters) {
			const processor = createSpanProcessor(exporter, {
				endpoint: traceEndpoint,
				headers: traceHeaders,
				insecure: this.options.otlpInsecure ?? false,
				protocol: "http/json",
			});
			if (processor) {
				processors.push(processor);
			}
		}
		if (processors.length === 0) {
			return null;
		}

		return new NodeTracerProvider({ resource, spanProcessors: processors });
	}

	private createLoggerProvider(
		resource: ReturnType<typeof resourceFromAttributes>,
	): LoggerProvider | null {
		const exporters = normalizeExporters(this.options.logsExporter);
		if (exporters.length === 0) {
			return null;
		}

		const processors = exporters
			.map((exporter) => {
				const logExporter = createLogExporter(exporter, {
					endpoint: this.options.otlpEndpoint,
					headers: this.options.otlpHeaders,
					insecure: this.options.otlpInsecure ?? false,
					protocol: "http/json",
				});
				if (!logExporter) {
					return null;
				}
				return new BatchLogRecordProcessor(logExporter, {
					maxQueueSize: this.options.logMaxQueueSize ?? 2048,
					maxExportBatchSize: this.options.logBatchSize ?? 512,
					scheduledDelayMillis:
						this.options.logBatchTimeoutMs ??
						this.options.logBatchTimeout ??
						5000,
				});
			})
			.filter((p): p is BatchLogRecordProcessor => p !== null);
		if (processors.length === 0) {
			return null;
		}
		return new LoggerProvider({ resource, processors });
	}
}

export function createOpenTelemetryTelemetryService(
	options: CreateOpenTelemetryTelemetryServiceOptions,
): { provider: OpenTelemetryProvider; telemetry: ITelemetryService } {
	const provider = new OpenTelemetryProvider(options);
	const telemetry = provider.createTelemetryService(options);
	telemetry.captureRequired("telemetry.provider_created", {
		provider: "opentelemetry",
		enabled: options.enabled ?? true,
		logsExporter: Array.isArray(options.logsExporter)
			? options.logsExporter.join(",")
			: options.logsExporter,
		metricsExporter: Array.isArray(options.metricsExporter)
			? options.metricsExporter.join(",")
			: options.metricsExporter,
		tracesExporter: Array.isArray(options.tracesExporter)
			? options.tracesExporter.join(",")
			: options.tracesExporter,
		otlpProtocol: options.otlpProtocol,
		hasOtlpEndpoint: Boolean(options.otlpEndpoint),
		serviceName: options.serviceName,
		serviceVersion: options.serviceVersion,
	});
	return {
		provider,
		telemetry,
	};
}

export function createConfiguredTelemetryService(
	options: CreateOpenTelemetryTelemetryServiceOptions,
): {
	provider?: OpenTelemetryProvider;
	telemetry: ITelemetryService;
} {
	if (options.enabled !== true) {
		return {
			telemetry: new TelemetryService({
				...options,
				distinctId: resolveCoreDistinctId(options.distinctId),
			}),
		};
	}

	return createOpenTelemetryTelemetryService(options);
}

function normalizeExporters(
	exporters: OpenTelemetryProviderOptions["logsExporter"],
): OpenTelemetryExporterKind[] {
	if (!exporters) {
		return [];
	}
	const values = Array.isArray(exporters) ? exporters : exporters.split(",");
	return values
		.map((value) => value.trim())
		.filter(
			(value): value is OpenTelemetryExporterKind =>
				value === "console" || value === "otlp",
		);
}

function createLogExporter(
	exporter: OpenTelemetryExporterKind,
	options: {
		endpoint?: string;
		headers?: Record<string, string>;
		insecure: boolean;
		protocol: OpenTelemetryProtocol;
	},
): LogRecordExporter | null {
	if (exporter === "console") {
		return new ConsoleLogRecordExporter();
	}
	if (!options.endpoint) {
		return null;
	}

	const endpoint = ensurePathSuffix(options.endpoint, "/v1/logs");
	return new OTLPLogExporterHttp({
		url: endpoint,
		headers: options.headers,
	});
}

function createSpanProcessor(
	exporter: OpenTelemetryExporterKind,
	options: {
		endpoint?: string;
		headers?: Record<string, string>;
		insecure: boolean;
		protocol: OpenTelemetryProtocol;
	},
): SpanProcessor | null {
	if (exporter === "console") {
		return new SimpleSpanProcessor(new ConsoleSpanExporter());
	}
	if (!options.endpoint) {
		return null;
	}

	const endpoint = ensurePathSuffix(options.endpoint, "/v1/traces");
	return new BatchSpanProcessor(
		new OTLPTraceExporter({
			url: endpoint,
			headers: options.headers,
		}),
	);
}

function createMetricReader(
	exporter: OpenTelemetryExporterKind,
	options: {
		endpoint?: string;
		headers?: Record<string, string>;
		insecure: boolean;
		protocol: OpenTelemetryProtocol;
		interval: number;
		timeout: number;
	},
): MetricReader | null {
	if (exporter === "console") {
		return new PeriodicExportingMetricReader({
			exporter: new ConsoleMetricExporter(),
			exportIntervalMillis: options.interval,
			exportTimeoutMillis: options.timeout,
		});
	}
	if (!options.endpoint) {
		return null;
	}

	const endpoint = ensurePathSuffix(options.endpoint, "/v1/metrics");
	return new PeriodicExportingMetricReader({
		exporter: new OTLPMetricExporterHttp({
			url: endpoint,
			headers: options.headers,
		}),
		exportIntervalMillis: options.interval,
		exportTimeoutMillis: options.timeout,
	});
}

function ensurePathSuffix(endpoint: string, suffix: string): string {
	const url = new URL(endpoint);
	const normalized = url.pathname.endsWith("/")
		? url.pathname.slice(0, -1)
		: url.pathname;
	url.pathname = normalized.endsWith(suffix)
		? normalized
		: `${normalized}${suffix}`;
	return url.toString();
}
