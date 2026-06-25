import type {
	BasicLogger,
	ITelemetryService,
	TelemetryMetadata,
	TelemetryProperties,
} from "@cline/shared";
import type { ITelemetryAdapter } from "./ITelemetryAdapter";
import { TelemetryLoggerSink } from "./TelemetryLoggerSink";

export interface TelemetryServiceOptions {
	adapters?: ITelemetryAdapter[];
	metadata?: Partial<TelemetryMetadata>;
	distinctId?: string;
	commonProperties?: TelemetryProperties;
	logger?: BasicLogger;
}

export class TelemetryService implements ITelemetryService {
	private adapters: ITelemetryAdapter[];
	private metadata: Partial<TelemetryMetadata>;
	private distinctId?: string;
	private commonProperties: TelemetryProperties;

	constructor(options: TelemetryServiceOptions = {}) {
		this.adapters = [...(options.adapters ?? [])];
		if (options.logger) {
			this.adapters.push(new TelemetryLoggerSink({ logger: options.logger }));
		}
		this.metadata = { ...(options.metadata ?? {}) };
		this.distinctId = options.distinctId;
		this.commonProperties = { ...(options.commonProperties ?? {}) };
	}

	addAdapter(adapter: ITelemetryAdapter): void {
		this.adapters.push(adapter);
	}

	setDistinctId(distinctId?: string): void {
		this.distinctId = distinctId;
	}

	setMetadata(metadata: Partial<TelemetryMetadata>): void {
		this.metadata = { ...metadata };
	}

	updateMetadata(metadata: Partial<TelemetryMetadata>): void {
		this.metadata = {
			...this.metadata,
			...metadata,
		};
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

	isEnabled(): boolean {
		return this.adapters.some((adapter) => adapter.isEnabled());
	}

	capture(input: { event: string; properties?: TelemetryProperties }): void {
		const properties = this.buildAttributes(input.properties);
		for (const adapter of this.adapters) {
			adapter.emit(input.event, properties);
		}
	}

	captureRequired(event: string, properties?: TelemetryProperties): void {
		const merged = this.buildAttributes(properties);
		for (const adapter of this.adapters) {
			adapter.emitRequired(event, merged);
		}
	}

	recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const merged = this.buildAttributes(attributes);
		for (const adapter of this.adapters) {
			adapter.recordCounter(name, value, merged, description, required);
		}
	}

	recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const merged = this.buildAttributes(attributes);
		for (const adapter of this.adapters) {
			adapter.recordHistogram(name, value, merged, description, required);
		}
	}

	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const merged = this.buildAttributes(attributes);
		for (const adapter of this.adapters) {
			adapter.recordGauge(name, value, merged, description, required);
		}
	}

	async flush(): Promise<void> {
		await Promise.all(this.adapters.map((adapter) => adapter.flush()));
	}

	async dispose(): Promise<void> {
		await Promise.all(this.adapters.map((adapter) => adapter.dispose()));
	}

	private buildAttributes(
		properties?: TelemetryProperties,
	): TelemetryProperties {
		return {
			...this.commonProperties,
			...properties,
			...this.metadata,
			...(this.distinctId ? { distinct_id: this.distinctId } : {}),
		};
	}
}
