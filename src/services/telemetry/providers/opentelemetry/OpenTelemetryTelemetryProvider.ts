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
	private eventCounter: ReturnType<Meter["createCounter"]> | null = null
	private userAttributes: Record<string, string> = {}

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
			this.eventCounter = this.meter.createCounter("cline.events", {
				description: "Count of telemetry events",
			})
		}

		if (loggerProvider) {
			this.logger = loggerProvider.getLogger("cline")
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

		// Record metric
		if (this.eventCounter) {
			this.eventCounter.add(1, {
				event_name: event,
				distinct_id: getDistinctId(),
				...this.flattenProperties(properties),
				...this.userAttributes,
			})
		}

		// Record log event
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
		if (this.eventCounter) {
			this.eventCounter.add(1, {
				event_name: event,
				distinct_id: getDistinctId(),
				_required: "true",
				...this.flattenProperties(properties),
				...this.userAttributes,
			})
		}

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
