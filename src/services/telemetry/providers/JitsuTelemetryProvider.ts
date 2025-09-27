import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { getDistinctId, setDistinctId } from "@/services/logging/distinctId"
import { Setting } from "@/shared/proto/index.host"
import { type JitsuClientConfig } from "@/shared/services/config/jitsu-config"
import type { ClineAccountUserInfo } from "../../auth/AuthService"
import type { ITelemetryProvider, TelemetrySettings } from "./ITelemetryProvider"

// Jitsu analytics client interface
interface JitsuClient {
	track(event: string, properties?: Record<string, unknown>): void
	identify(userId: string, traits?: Record<string, unknown>): void
	page(name?: string, properties?: Record<string, unknown>): void
	setAnonymousId(id: string): void
	configure(config: any): void
}

// Dynamic import for Jitsu client (will be installed)
declare const jitsuAnalytics: (config: JitsuClientConfig) => JitsuClient

/**
 * Jitsu implementation of the telemetry provider interface
 * Handles Jitsu-specific analytics tracking
 */
export class JitsuTelemetryProvider implements ITelemetryProvider {
	private client: JitsuClient | null = null
	private telemetrySettings: TelemetrySettings
	private config: JitsuClientConfig

	constructor(config: JitsuClientConfig) {
		this.config = config

		// Initialize telemetry settings
		this.telemetrySettings = {
			extensionEnabled: true,
			hostEnabled: true,
			level: "all",
		}
	}

	public async initialize(): Promise<JitsuTelemetryProvider> {
		try {
			// Initialize Jitsu client with configuration
			if (typeof jitsuAnalytics !== "undefined" && this.config.writeKey) {
				this.client = jitsuAnalytics({
					writeKey: this.config.writeKey,
					host: this.config.host,
					debug: this.config.debug,
					privacy: this.config.privacy,
				})

				// Set initial anonymous ID
				const distinctId = getDistinctId()
				if (distinctId && distinctId.startsWith("cl-")) {
					this.client.setAnonymousId(distinctId)
				}
			} else {
				console.warn("JitsuTelemetryProvider: Jitsu client not available or no write key configured")
			}
		} catch (error) {
			console.error("JitsuTelemetryProvider: Failed to initialize Jitsu client:", error)
		}

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

	public log(event: string, properties?: Record<string, unknown>): void {
		if (!this.client || !this.isEnabled() || this.telemetrySettings.level === "off") {
			return
		}

		// Filter events based on telemetry level
		if (this.telemetrySettings.level === "error") {
			if (!event.includes("error")) {
				return
			}
		}

		try {
			this.client.track(event, properties)
		} catch (error) {
			console.error("JitsuTelemetryProvider: Failed to track event:", error)
		}
	}

	public logRequired(event: string, properties?: Record<string, unknown>): void {
		if (!this.client) {
			return
		}

		try {
			this.client.track(event, {
				...properties,
				_required: true, // Mark as required event
			})
		} catch (error) {
			console.error("JitsuTelemetryProvider: Failed to track required event:", error)
		}
	}

	public identifyUser(userInfo: ClineAccountUserInfo, properties: Record<string, unknown> = {}): void {
		if (!this.client) {
			return
		}

		const distinctId = getDistinctId()
		// Only identify user if telemetry is enabled and user ID is different than the currently set distinct ID
		if (this.isEnabled() && userInfo && userInfo?.id !== distinctId) {
			try {
				this.client.identify(userInfo.id, {
					uuid: userInfo.id,
					email: userInfo.email,
					name: userInfo.displayName,
					...properties,
				})
				// Ensure distinct ID is updated so that we will not identify the user again
				setDistinctId(userInfo.id)
			} catch (error) {
				console.error("JitsuTelemetryProvider: Failed to identify user:", error)
			}
		}
	}

	public setOptIn(optIn: boolean): void {
		this.telemetrySettings.extensionEnabled = optIn

		// Update Jitsu privacy settings
		if (this.client) {
			try {
				this.client.configure({
					privacy: {
						...this.config.privacy,
						dontSend: !optIn,
					},
				})
			} catch (error) {
				console.error("JitsuTelemetryProvider: Failed to update opt-in setting:", error)
			}
		}
	}

	public isEnabled(): boolean {
		return this.telemetrySettings.extensionEnabled && this.telemetrySettings.hostEnabled
	}

	public getSettings(): TelemetrySettings {
		return { ...this.telemetrySettings }
	}

	public async dispose(): Promise<void> {
		// Jitsu client doesn't require explicit cleanup
		this.client = null
		console.debug("JitsuTelemetryProvider: Disposed")
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
}
