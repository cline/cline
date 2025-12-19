import { Meter } from "@opentelemetry/api"
import type { Logger as OTELLogger } from "@opentelemetry/api-logs"
import { LoggerProvider } from "@opentelemetry/sdk-logs"
import { MeterProvider } from "@opentelemetry/sdk-metrics"
import { HostProvider } from "@/hosts/host-provider"
import { getErrorLevelFromString } from "@/services/error"
import { getDistinctId, setDistinctId } from "@/services/logging/distinctId"
import { Setting } from "@/shared/proto/index.host"
import type { ClineAccountUserInfo } from "../../../auth/AuthService"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "../ITelemetryProvider"

/**
 * OpenTelemetry implementation of the telemetry provider interface.
 * Handles metrics and event logging using OpenTelemetry standards.
 */
export class OpenTelemetryTelemetryProvider implements ITelemetryProvider {
	private meter: Meter | null = null
	private logger: OTELLogger | null = null
	private telemetrySettings: TelemetrySettings
	private userAttributes: Record<string, string> = {}
	// Lazy instrument caches for metrics
	private counters = new Map<string, ReturnType<Meter["createCounter"]>>()
	private histograms = new Map<string, ReturnType<Meter["createHistogram"]>>()
	private gauges = new Map<string, ReturnType<Meter["createObservableGauge"]>>()
	private gaugeValues = new Map<string, Map<string, { value: number; attributes?: TelemetryProperties }>>()

	readonly name: string
	private bypassUserSettings: boolean

	constructor(
		meterProvider: MeterProvider | null,
		loggerProvider: LoggerProvider | null,
		{ name, bypassUserSettings }: { name?: string; bypassUserSettings: boolean },
	) {
		this.name = name || "OpenTelemetryProvider"
		this.bypassUserSettings = bypassUserSettings

		// Initialize telemetry settings
		this.telemetrySettings = {
			extensionEnabled: true,
			hostEnabled: true,
			level: "all",
		}

		if (meterProvider) {
			this.meter = meterProvider.getMeter("cline")
		}

		if (loggerProvider) {
			this.logger = loggerProvider.getLogger("cline")
		}

		// Log initialization status
		const loggerReady = !!this.logger
		const meterReady = !!this.meter
		if (loggerReady || meterReady) {
			console.log(`[OTEL] Provider initialized - Logger: ${loggerReady}, Meter: ${meterReady}`)
		}
	}

	public async initialize(): Promise<OpenTelemetryTelemetryProvider> {
		if (this.bypassUserSettings) {
			return this
		}

		// Listen for host telemetry changes
		HostProvider.env.subscribeToTelemetrySettings(
			{},
			{
				onResponse: (event: { isEnabled: Setting }) => {
					const hostEnabled = event.isEnabled === Setting.ENABLED || event.isEnabled === Setting.UNSUPPORTED
					this.telemetrySettings.hostEnabled = hostEnabled
				},
			},
		)

		// Check host-specific telemetry setting (e.g. VS Code setting)
		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			this.telemetrySettings.hostEnabled = false
		}

		this.telemetrySettings.level = await this.getTelemetryLevel()
		return this
	}

	public log(event: string, properties?: TelemetryProperties): void {
		if (!this.isEnabled() || this.telemetrySettings.level === "off") {
			return
		}

		// Filter events based on telemetry level
		if (this.telemetrySettings.level === "error") {
			if (!event.includes("error")) {
				return
			}
		}

		// Record log event (primary path)
		if (this.logger) {
			this.logger.emit({
				severityText: "INFO",
				body: event,
				attributes: {
					distinct_id: getDistinctId(),
					...this.flattenProperties(properties),
					...this.userAttributes,
				},
			})
		}
	}

	public logRequired(event: string, properties?: TelemetryProperties): void {
		// Required events always go through regardless of settings
		if (this.logger) {
			this.logger.emit({
				severityText: "INFO",
				body: event,
				attributes: {
					distinct_id: getDistinctId(),
					_required: true,
					...this.flattenProperties(properties),
					...this.userAttributes,
				},
			})
		}
	}

	public identifyUser(userInfo: ClineAccountUserInfo, properties: TelemetryProperties = {}): void {
		const distinctId = getDistinctId()
		// Only identify user if telemetry is enabled and user ID is different than the currently set distinct ID
		if (this.isEnabled() && userInfo && userInfo?.id !== distinctId) {
			// Store user attributes for future events
			this.userAttributes = {
				user_id: userInfo.id,
				user_name: userInfo.displayName || "",
				...this.flattenProperties(properties),
			}

			// Emit identification event
			if (this.logger) {
				this.logger.emit({
					severityText: "INFO",
					body: "user_identified",
					attributes: {
						...this.userAttributes,
						alias: distinctId,
					},
				})
			}

			// Ensure distinct ID is updated so that we will not identify the user again
			setDistinctId(userInfo.id)
		}
	}

	// Set extension-specific telemetry setting - opt-in/opt-out via UI
	public setOptIn(optIn: boolean): void {
		this.telemetrySettings.extensionEnabled = optIn
	}

	public isEnabled(): boolean {
		return this.bypassUserSettings || (this.telemetrySettings.extensionEnabled && this.telemetrySettings.hostEnabled)
	}

	public getSettings(): TelemetrySettings {
		return { ...this.telemetrySettings }
	}

	/**
	 * Record a counter metric (cumulative value that only increases)
	 * Lazy creation - only creates the counter on first use if meter is available.
	 */
	public recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		if (!this.meter || (!required && !this.isEnabled())) {
			return
		}

		let counter = this.counters.get(name)
		if (!counter) {
			const options = description ? { description } : undefined
			counter = this.meter.createCounter(name, options)
			this.counters.set(name, counter)
			console.log(`[OTEL] Created counter: ${name}`)
		}

		counter.add(value, this.flattenProperties(attributes))
	}

	/**
	 * Record a histogram metric (distribution of values for percentile analysis)
	 * Lazy creation - only creates the histogram on first use if meter is available.
	 */
	public recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		if (!this.meter || (!required && !this.isEnabled())) {
			return
		}

		let histogram = this.histograms.get(name)
		if (!histogram) {
			const options = description ? { description } : undefined
			histogram = this.meter.createHistogram(name, options)
			this.histograms.set(name, histogram)
			console.log(`[OTEL] Created histogram: ${name}`)
		}

		histogram.record(value, this.flattenProperties(attributes))
	}

	/**
	 * Record a gauge metric (point-in-time value that can go up or down)
	 * Lazy creation - creates an observable gauge that reads from stored values
	 */
	public recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		if (!this.meter || (!required && !this.isEnabled())) {
			return
		}

		const attrKey = attributes ? JSON.stringify(attributes) : ""

		const existingSeries = this.gaugeValues.get(name)

		if (value === null) {
			if (existingSeries) {
				existingSeries.delete(attrKey)
				if (existingSeries.size === 0) {
					this.gaugeValues.delete(name)
					this.gauges.delete(name)
				}
			}
			return
		}

		let series = existingSeries
		if (!series) {
			series = new Map()
			this.gaugeValues.set(name, series)
		}

		if (!this.gauges.has(name)) {
			const options = description ? { description } : undefined
			const gauge = this.meter.createObservableGauge(name, options)

			gauge.addCallback((observableResult) => {
				const snapshot = this.snapshotGaugeSeries(name)
				if (snapshot.length === 0) {
					return
				}
				for (const data of snapshot) {
					observableResult.observe(data.value, this.flattenProperties(data.attributes))
				}
			})

			this.gauges.set(name, gauge)
			console.log(`[OTEL] Created gauge: ${name}`)
		}

		series.set(attrKey, { value, attributes })
	}

	private snapshotGaugeSeries(name: string): Array<{ value: number; attributes?: TelemetryProperties }> {
		const series = this.gaugeValues.get(name)
		if (!series) {
			return []
		}
		const snapshot: Array<{ value: number; attributes?: TelemetryProperties }> = []
		for (const data of series.values()) {
			snapshot.push({
				value: data.value,
				attributes: data.attributes ? { ...data.attributes } : undefined,
			})
		}
		return snapshot
	}

	public async dispose(): Promise<void> {
		// OpenTelemetry client provider handles shutdown
		// Individual providers don't need to do anything
	}

	/**
	 * Get the current telemetry level from VS Code settings
	 */
	private async getTelemetryLevel(): Promise<TelemetrySettings["level"]> {
		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			return "off"
		}
		return getErrorLevelFromString(hostSettings.errorLevel)
	}

	/**
	 * Flatten nested properties into dot-notation strings for OpenTelemetry attributes.
	 * OpenTelemetry attributes must be primitives (string, number, boolean).
	 * Adds protection against circular references, prototype pollution, deep graphs,
	 * and limits array sizes to avoid performance issues.
	 */
	private flattenProperties(
		properties?: TelemetryProperties,
		prefix = "",
		seen: WeakSet<object> = new WeakSet(),
		depth = 0,
	): Record<string, string | number | boolean> {
		if (!properties) {
			return {}
		}

		const flattened: Record<string, string | number | boolean> = {}
		const MAX_ARRAY_SIZE = 100
		const MAX_DEPTH = 10

		for (const [key, value] of Object.entries(properties)) {
			// Skip prototype pollution vectors
			if (key === "__proto__" || key === "constructor" || key === "prototype") {
				continue
			}

			const fullKey = prefix ? `${prefix}.${key}` : key

			if (value === null || value === undefined) {
				flattened[fullKey] = String(value)
			} else if (Array.isArray(value)) {
				// Limit array size to prevent performance issues
				const limited = value.length > MAX_ARRAY_SIZE ? value.slice(0, MAX_ARRAY_SIZE) : value
				try {
					flattened[fullKey] = JSON.stringify(limited)
				} catch {
					flattened[fullKey] = "[UnserializableArray]"
				}
				if (value.length > MAX_ARRAY_SIZE) {
					flattened[`${fullKey}_truncated`] = true
					flattened[`${fullKey}_original_length`] = value.length
				}
			} else if (typeof value === "object") {
				// Handle special objects
				if (value instanceof Date) {
					flattened[fullKey] = value.toISOString()
					continue
				}
				if (value instanceof Error) {
					flattened[fullKey] = value.message
					continue
				}

				// Check for circular references
				if (seen.has(value as object)) {
					flattened[fullKey] = "[Circular]"
					continue
				}
				// Depth guard
				if (depth >= MAX_DEPTH) {
					flattened[fullKey] = "[MaxDepthExceeded]"
					continue
				}

				seen.add(value as object)
				Object.assign(flattened, this.flattenProperties(value as TelemetryProperties, fullKey, seen, depth + 1))
			} else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				flattened[fullKey] = value
			} else {
				// Fallback: stringify unknown types
				try {
					flattened[fullKey] = JSON.stringify(value as unknown as object)
				} catch {
					flattened[fullKey] = String(value)
				}
			}
		}

		return flattened
	}
}
