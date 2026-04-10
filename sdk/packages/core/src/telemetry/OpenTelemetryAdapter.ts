import type { Meter } from "@opentelemetry/api";
import type { Logger as OpenTelemetryLogger } from "@opentelemetry/api-logs";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import type { MeterProvider } from "@opentelemetry/sdk-metrics";
import type {
	ITelemetryAdapter,
	TelemetryMetadata,
	TelemetryPrimitive,
	TelemetryProperties,
} from "./ITelemetryAdapter";

type FlatTelemetryAttributes = Record<string, string | number | boolean>;

export interface OpenTelemetryAdapterOptions {
	readonly metadata: TelemetryMetadata;
	readonly meterProvider?: MeterProvider | null;
	readonly loggerProvider?: LoggerProvider | null;
	readonly name?: string;
	readonly enabled?: boolean | (() => boolean);
	readonly distinctId?: string;
	readonly commonProperties?: TelemetryProperties;
}

export class OpenTelemetryAdapter implements ITelemetryAdapter {
	readonly name: string;

	private readonly metadata: TelemetryMetadata;
	private readonly meter: Meter | null;
	private readonly logger: OpenTelemetryLogger | null;
	private readonly enabled: boolean | (() => boolean);
	private distinctId?: string;
	private commonProperties: TelemetryProperties;
	private counters = new Map<string, ReturnType<Meter["createCounter"]>>();
	private histograms = new Map<string, ReturnType<Meter["createHistogram"]>>();
	private gauges = new Map<
		string,
		ReturnType<Meter["createObservableGauge"]>
	>();
	private gaugeValues = new Map<
		string,
		Map<string, { value: number; attributes?: TelemetryProperties }>
	>();
	private readonly meterProvider?: MeterProvider | null;
	private readonly loggerProvider?: LoggerProvider | null;

	constructor(options: OpenTelemetryAdapterOptions) {
		this.name = options.name ?? "OpenTelemetryAdapter";
		this.metadata = { ...options.metadata };
		this.meterProvider = options.meterProvider;
		this.loggerProvider = options.loggerProvider;
		this.meter = options.meterProvider?.getMeter("cline") ?? null;
		this.logger = options.loggerProvider?.getLogger("cline") ?? null;
		this.enabled = options.enabled ?? true;
		this.distinctId = options.distinctId;
		this.commonProperties = options.commonProperties
			? { ...options.commonProperties }
			: {};
	}

	emit(event: string, properties?: TelemetryProperties): void {
		if (!this.isEnabled()) {
			return;
		}
		this.emitLog(event, properties, false);
	}

	emitRequired(event: string, properties?: TelemetryProperties): void {
		this.emitLog(event, properties, true);
	}

	recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		if (!this.meter || (!required && !this.isEnabled())) {
			return;
		}

		let counter = this.counters.get(name);
		if (!counter) {
			counter = this.meter.createCounter(
				name,
				description ? { description } : undefined,
			);
			this.counters.set(name, counter);
		}

		counter.add(
			value,
			this.flattenProperties(this.buildAttributes(attributes)),
		);
	}

	recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		if (!this.meter || (!required && !this.isEnabled())) {
			return;
		}

		let histogram = this.histograms.get(name);
		if (!histogram) {
			histogram = this.meter.createHistogram(
				name,
				description ? { description } : undefined,
			);
			this.histograms.set(name, histogram);
		}

		histogram.record(
			value,
			this.flattenProperties(this.buildAttributes(attributes)),
		);
	}

	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		if (!this.meter || (!required && !this.isEnabled())) {
			return;
		}

		const mergedAttributes = this.buildAttributes(attributes);
		const attrKey = JSON.stringify(mergedAttributes);
		const existingSeries = this.gaugeValues.get(name);

		if (value === null) {
			if (existingSeries) {
				existingSeries.delete(attrKey);
				if (existingSeries.size === 0) {
					this.gaugeValues.delete(name);
					this.gauges.delete(name);
				}
			}
			return;
		}

		let series = existingSeries;
		if (!series) {
			series = new Map();
			this.gaugeValues.set(name, series);
		}

		if (!this.gauges.has(name)) {
			const gauge = this.meter.createObservableGauge(
				name,
				description ? { description } : undefined,
			);
			gauge.addCallback((observableResult) => {
				for (const data of this.snapshotGaugeSeries(name)) {
					observableResult.observe(
						data.value,
						this.flattenProperties(data.attributes),
					);
				}
			});
			this.gauges.set(name, gauge);
		}

		series.set(attrKey, { value, attributes: mergedAttributes });
	}

	isEnabled(): boolean {
		return typeof this.enabled === "function" ? this.enabled() : this.enabled;
	}

	setDistinctId(distinctId?: string): void {
		this.distinctId = distinctId;
	}

	setCommonProperties(properties: TelemetryProperties): void {
		this.commonProperties = { ...properties };
	}

	updateCommonProperties(properties: TelemetryProperties): void {
		this.commonProperties = {
			...this.commonProperties,
			...properties,
		};
	}

	async flush(): Promise<void> {
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

	private emitLog(
		event: string,
		properties: TelemetryProperties | undefined,
		required: boolean,
	): void {
		if (!this.logger) {
			return;
		}

		const attributes = this.flattenProperties(
			this.buildAttributes(properties, required),
		);
		this.logger.emit({
			severityText: "INFO",
			body: event,
			attributes,
		});
	}

	private buildAttributes(
		properties?: TelemetryProperties,
		required = false,
	): TelemetryProperties {
		return {
			...this.commonProperties,
			...this.metadata,
			...properties,
			...(this.distinctId ? { distinct_id: this.distinctId } : {}),
			...(required ? { _required: true } : {}),
		};
	}

	private snapshotGaugeSeries(
		name: string,
	): Array<{ value: number; attributes?: TelemetryProperties }> {
		const series = this.gaugeValues.get(name);
		if (!series) {
			return [];
		}
		return Array.from(series.values(), (entry) => ({
			value: entry.value,
			attributes: entry.attributes ? { ...entry.attributes } : undefined,
		}));
	}

	private flattenProperties(
		properties?: TelemetryProperties,
		prefix = "",
		seen: WeakSet<object> = new WeakSet(),
		depth = 0,
	): FlatTelemetryAttributes {
		if (!properties) {
			return {};
		}

		const flattened: FlatTelemetryAttributes = {};
		const maxArraySize = 100;
		const maxDepth = 10;

		for (const [key, value] of Object.entries(properties)) {
			if (key === "__proto__" || key === "constructor" || key === "prototype") {
				continue;
			}

			const fullKey = prefix ? `${prefix}.${key}` : key;

			if (value === null || value === undefined) {
				flattened[fullKey] = String(value);
				continue;
			}

			if (Array.isArray(value)) {
				const limited =
					value.length > maxArraySize ? value.slice(0, maxArraySize) : value;
				try {
					flattened[fullKey] = JSON.stringify(limited);
				} catch {
					flattened[fullKey] = "[UnserializableArray]";
				}
				if (value.length > maxArraySize) {
					flattened[`${fullKey}_truncated`] = true;
					flattened[`${fullKey}_original_length`] = value.length;
				}
				continue;
			}

			if (typeof value === "object") {
				if (value instanceof Date) {
					flattened[fullKey] = value.toISOString();
					continue;
				}
				if (value instanceof Error) {
					flattened[fullKey] = value.message;
					continue;
				}
				if (seen.has(value)) {
					flattened[fullKey] = "[Circular]";
					continue;
				}
				if (depth >= maxDepth) {
					flattened[fullKey] = "[MaxDepthExceeded]";
					continue;
				}

				seen.add(value);
				Object.assign(
					flattened,
					this.flattenProperties(
						value as TelemetryProperties,
						fullKey,
						seen,
						depth + 1,
					),
				);
				continue;
			}

			if (isTelemetryPrimitive(value)) {
				flattened[fullKey] = value;
				continue;
			}

			try {
				flattened[fullKey] = JSON.stringify(value);
			} catch {
				flattened[fullKey] = String(value);
			}
		}

		return flattened;
	}
}

function isTelemetryPrimitive(
	value: unknown,
): value is Exclude<TelemetryPrimitive, null | undefined> {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}
