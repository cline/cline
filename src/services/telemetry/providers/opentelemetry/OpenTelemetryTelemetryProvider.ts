import { Meter } from "@opentelemetry/api"
import type { Logger as OTELLogger } from "@opentelemetry/api-logs"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { getDistinctId, setDistinctId } from "@/services/logging/distinctId"
import { Setting } from "@/shared/proto/index.host"
import type { ClineAccountUserInfo } from "../../../auth/AuthService"
import type { ITelemetryProvider, TelemetryProperties, TelemetrySettings } from "../ITelemetryProvider"
import { OpenTelemetryClientProvider } from "./OpenTelemetryClientProvider"

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

	constructor() {
		// Initialize telemetry settings
		this.telemetrySettings = {
			extensionEnabled: true,
			hostEnabled: true,
			level: "all",
		}

		// Get meter and logger from the shared client provider
		const meterProvider = OpenTelemetryClientProvider.getMeterProvider()
		const loggerProvider = OpenTelemetryClientProvider.getLoggerProvider()

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
		// Listen for host telemetry changes
		HostProvider.env.subscribeToTelemetrySettings(
			{},
			{
				onResponse: (event) => {
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
				user_email: userInfo.email || "",
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
		return this.telemetrySettings.extensionEnabled && this.telemetrySettings.hostEnabled
	}

	public getSettings(): TelemetrySettings {
		return { ...this.telemetrySettings }
	}

	/**
	 * Increment a counter metric (lazy creation).
	 * Only creates the counter on first use if meter is available.
	 */
	public incrementCounter(name: string, value: number = 1, attributes?: TelemetryProperties): void {
		if (!this.meter) {
			return
		}

		let counter = this.counters.get(name)
		if (!counter) {
			counter = this.meter.createCounter(name)
			this.counters.set(name, counter)
			console.log(`[OTEL] Created counter: ${name}`)
		}

		counter.add(value, this.flattenProperties(attributes))
	}

	/**
	 * Record a histogram metric (lazy creation).
	 * Only creates the histogram on first use if meter is available.
	 */
	public recordHistogram(name: string, value: number, attributes?: TelemetryProperties): void {
		if (!this.meter) {
			return
		}

		let histogram = this.histograms.get(name)
		if (!histogram) {
			histogram = this.meter.createHistogram(name)
			this.histograms.set(name, histogram)
			console.log(`[OTEL] Created histogram: ${name}`)
		}

		histogram.record(value, this.flattenProperties(attributes))
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
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<TelemetrySettings["level"]>("telemetryLevel") || "all"
	}

	/**
	 * Flatten nested properties into dot-notation strings for OpenTelemetry attributes.
	 * OpenTelemetry attributes must be primitives (string, number, boolean).
	 */
	private flattenProperties(properties?: TelemetryProperties, prefix = ""): Record<string, string | number | boolean> {
		if (!properties) {
			return {}
		}

		const flattened: Record<string, string | number | boolean> = {}

		for (const [key, value] of Object.entries(properties)) {
			const fullKey = prefix ? `${prefix}.${key}` : key

			if (value === null || value === undefined) {
				flattened[fullKey] = String(value)
			} else if (typeof value === "object" && !Array.isArray(value)) {
				// Recursively flatten nested objects
				Object.assign(flattened, this.flattenProperties(value as TelemetryProperties, fullKey))
			} else if (Array.isArray(value)) {
				// Convert arrays to JSON strings
				flattened[fullKey] = JSON.stringify(value)
			} else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				flattened[fullKey] = value
			} else {
				// Fallback: stringify unknown types
				flattened[fullKey] = JSON.stringify(value)
			}
		}

		return flattened
	}
}
