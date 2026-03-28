import type {
	BasicLogger,
	ITelemetryService,
	OpenTelemetryClientConfig,
	TelemetryMetadata,
} from "@clinebot/shared";
import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter as OTLPLogExporterHttp } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter as OTLPMetricExporterHttp } from "@opentelemetry/exporter-metrics-otlp-http";
import { Resource } from "@opentelemetry/resources";
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
		"enabled" | "logsExporter" | "metricsExporter"
	> {
	serviceName?: string;
	serviceVersion?: string;
	enabled?: boolean;
	logsExporter?: string | OpenTelemetryExporterKind[];
	metricsExporter?: string | OpenTelemetryExporterKind[];
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
	private readonly options: OpenTelemetryProviderOptions;

	constructor(options: OpenTelemetryProviderOptions = {}) {
		this.options = options;
		const resource = new Resource({
			[ATTR_SERVICE_NAME]: options.serviceName ?? "cline",
			...(options.serviceVersion
				? { [ATTR_SERVICE_VERSION]: options.serviceVersion }
				: {}),
		});

		this.meterProvider = this.createMeterProvider(resource);
		this.loggerProvider = this.createLoggerProvider(resource);

		if (this.meterProvider) {
			metrics.setGlobalMeterProvider(this.meterProvider);
		}
		if (this.loggerProvider) {
			logs.setGlobalLoggerProvider(this.loggerProvider);
		}
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
			adapters: [adapter],
			distinctId: resolveCoreDistinctId(options.distinctId),
			commonProperties: options.commonProperties,
			logger: options.logger,
		});
	}

	async forceFlush(): Promise<void> {
		await Promise.all([
			this.meterProvider?.forceFlush?.(),
			this.loggerProvider?.forceFlush?.(),
		]);
	}

	async dispose(): Promise<void> {
		await Promise.all([
			this.meterProvider?.shutdown?.(),
			this.loggerProvider?.shutdown?.(),
		]);
	}

	private createMeterProvider(resource: Resource): MeterProvider | null {
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

	private createLoggerProvider(resource: Resource): LoggerProvider | null {
		const exporters = normalizeExporters(this.options.logsExporter);
		if (exporters.length === 0) {
			return null;
		}

		const provider = new LoggerProvider({ resource });
		for (const exporter of exporters) {
			const logExporter = createLogExporter(exporter, {
				endpoint: this.options.otlpEndpoint,
				headers: this.options.otlpHeaders,
				insecure: this.options.otlpInsecure ?? false,
				protocol: "http/json",
			});
			if (!logExporter) {
				continue;
			}
			provider.addLogRecordProcessor(
				new BatchLogRecordProcessor(logExporter, {
					maxQueueSize: this.options.logMaxQueueSize ?? 2048,
					maxExportBatchSize: this.options.logBatchSize ?? 512,
					scheduledDelayMillis:
						this.options.logBatchTimeoutMs ??
						this.options.logBatchTimeout ??
						5000,
				}),
			);
		}
		return provider;
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
