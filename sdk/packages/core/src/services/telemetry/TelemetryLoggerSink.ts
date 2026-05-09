import type { BasicLogger } from "@clinebot/shared";
import type {
	ITelemetryAdapter,
	TelemetryProperties,
} from "./ITelemetryAdapter";

/**
 * {@link ITelemetryAdapter} implementation that forwards telemetry to a {@link BasicLogger}.
 *
 * This is intentionally named *Sink* (not "adapter") to distinguish it from host logging bridges
 * such as the CLI Pino bundle: it consumes telemetry events and writes them to the injected logger.
 */
export interface TelemetryLoggerSinkOptions {
	logger?: BasicLogger;
	name?: string;
	enabled?: boolean | (() => boolean);
}

export class TelemetryLoggerSink implements ITelemetryAdapter {
	readonly name: string;

	private readonly logger?: BasicLogger;
	private readonly enabled: boolean | (() => boolean);

	constructor(options: TelemetryLoggerSinkOptions = {}) {
		this.name = options.name ?? "TelemetryLoggerSink";
		this.logger = options.logger;
		this.enabled = options.enabled ?? true;
	}

	emit(event: string, properties?: TelemetryProperties): void {
		if (!this.isEnabled()) {
			return;
		}
		this.logger?.log("telemetry.event", {
			telemetrySink: this.name,
			event,
			properties,
		});
	}

	emitRequired(event: string, properties?: TelemetryProperties): void {
		this.logger?.log("telemetry.required_event", {
			telemetrySink: this.name,
			severity: "warn",
			event,
			properties,
		});
	}

	recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void {
		if (!required && !this.isEnabled()) {
			return;
		}
		this.logger?.debug("telemetry.metric", {
			telemetrySink: this.name,
			instrument: "counter",
			name,
			value,
			attributes,
			description,
			required: required === true,
		});
	}

	recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void {
		if (!required && !this.isEnabled()) {
			return;
		}
		this.logger?.debug("telemetry.metric", {
			telemetrySink: this.name,
			instrument: "histogram",
			name,
			value,
			attributes,
			description,
			required: required === true,
		});
	}

	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void {
		if (!required && !this.isEnabled()) {
			return;
		}
		this.logger?.debug("telemetry.metric", {
			telemetrySink: this.name,
			instrument: "gauge",
			name,
			value,
			attributes,
			description,
			required: required === true,
		});
	}

	isEnabled(): boolean {
		return typeof this.enabled === "function" ? this.enabled() : this.enabled;
	}

	async flush(): Promise<void> {}

	async dispose(): Promise<void> {}
}
