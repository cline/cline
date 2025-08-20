import { PostHog } from "posthog-node"
import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"
import { posthogConfig } from "../../../shared/services/config/posthog-config"
import type { ClineAccountUserInfo } from "../../auth/AuthService"
import type { ITelemetryProvider, TelemetrySettings } from "../ITelemetryProvider"

// Prefer host-provided UUID when running via HostBridge; fall back to VS Code's machineId, then a random UUID
const ENV_ID = process?.env?.UUID ?? vscode?.env?.machineId ?? uuidv4()

/**
 * PostHog implementation of the telemetry provider interface
 * Handles PostHog-specific analytics tracking
 */
export class PostHogTelemetryProvider implements ITelemetryProvider {
	private client: PostHog
	private distinctId: string
	private telemetrySettings: TelemetrySettings
	private isSharedClient: boolean

	constructor(distinctId: string = ENV_ID, sharedClient?: PostHog) {
		this.distinctId = distinctId
		this.isSharedClient = !!sharedClient

		// Use shared PostHog client if provided, otherwise create a new one
		this.client =
			sharedClient ||
			new PostHog(posthogConfig.apiKey, {
				host: posthogConfig.host,
			})

		// Initialize telemetry settings
		this.telemetrySettings = {
			extensionEnabled: true,
			hostEnabled: true,
			level: "all",
		}

		// Listen for VS Code telemetry changes
		vscode.env.onDidChangeTelemetryEnabled((isTelemetryEnabled) => {
			this.telemetrySettings.hostEnabled = isTelemetryEnabled
		})

		if (vscode?.env?.isTelemetryEnabled === false) {
			this.telemetrySettings.hostEnabled = false
		}

		// Check extension-specific telemetry setting
		const config = vscode.workspace.getConfiguration("cline")
		if (config.get("telemetrySetting") === "disabled") {
			this.telemetrySettings.extensionEnabled = false
		}

		this.telemetrySettings.level = this.getTelemetryLevel()
	}

	public log(event: string, properties?: Record<string, unknown>): void {
		if (!this.isEnabled() || this.telemetrySettings.level === "off") {
			return
		}

		// Filter events based on telemetry level
		if (this.telemetrySettings.level === "error") {
			if (!event.includes("error")) {
				return
			}
		}

		this.client.capture({
			distinctId: this.distinctId,
			event,
			properties,
		})
	}

	public identifyUser(userInfo: ClineAccountUserInfo, properties: Record<string, unknown> = {}): void {
		if (!this.isEnabled()) {
			return
		}

		if (userInfo && userInfo?.id !== this.distinctId) {
			this.client.identify({
				distinctId: userInfo.id,
				properties: {
					uuid: userInfo.id,
					email: userInfo.email,
					name: userInfo.displayName,
					...properties,
					alias: this.distinctId,
				},
			})
			this.distinctId = userInfo.id
		}
	}

	public setOptIn(optIn: boolean): void {
		if (optIn && !this.telemetrySettings.extensionEnabled) {
			this.client.optIn()
		}
		if (!optIn && this.telemetrySettings.extensionEnabled) {
			this.client.optOut()
		}
		this.telemetrySettings.extensionEnabled = optIn
	}

	public isEnabled(): boolean {
		return this.telemetrySettings.extensionEnabled && this.telemetrySettings.hostEnabled
	}

	public getSettings(): TelemetrySettings {
		return { ...this.telemetrySettings }
	}

	public async dispose(): Promise<void> {
		// Only shut down the client if it's not shared (we own it)
		if (!this.isSharedClient) {
			try {
				await this.client.shutdown()
			} catch (error) {
				console.error("Error shutting down PostHog client:", error)
			}
		}
	}

	/**
	 * Get the current telemetry level from VS Code settings
	 */
	private getTelemetryLevel(): TelemetrySettings["level"] {
		if (!vscode?.env?.isTelemetryEnabled) {
			return "off"
		}
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<TelemetrySettings["level"]>("telemetryLevel") || "all"
	}

	/**
	 * Get the distinct ID for this provider instance
	 */
	public getDistinctId(): string {
		return this.distinctId
	}
}
