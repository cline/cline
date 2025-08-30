import { PostHog } from "posthog-node"
import * as vscode from "vscode"
import { getDistinctId, setDistinctId } from "@/services/logging/distinctId"
import { posthogConfig } from "../../../shared/services/config/posthog-config"
import type { ClineAccountUserInfo } from "../../auth/AuthService"
import type { ITelemetryProvider, TelemetrySettings } from "./ITelemetryProvider"
/**
 * PostHog implementation of the telemetry provider interface
 * Handles PostHog-specific analytics tracking
 */
export class PostHogTelemetryProvider implements ITelemetryProvider {
	private client: PostHog
	private telemetrySettings: TelemetrySettings
	private isSharedClient: boolean

	constructor(sharedClient?: PostHog) {
		this.isSharedClient = !!sharedClient

		// Use shared PostHog client if provided, otherwise create a new one
		if (sharedClient) {
			this.client = sharedClient
		} else {
			// Only create a new client if we have an API key
			if (!posthogConfig.apiKey) {
				throw new Error("PostHog API key is required to create a new client")
			}
			this.client = new PostHog(posthogConfig.apiKey, {
				host: posthogConfig.host,
			})
		}

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
			distinctId: getDistinctId(),
			event,
			properties,
		})
	}

	public identifyUser(userInfo: ClineAccountUserInfo, properties: Record<string, unknown> = {}): void {
		const distinctId = getDistinctId()
		// Only identify user if telemetry is enabled and user ID is different than the currently set distinct ID
		if (this.isEnabled() && userInfo && userInfo?.id !== distinctId) {
			this.client.identify({
				distinctId: userInfo.id,
				properties: {
					uuid: userInfo.id,
					email: userInfo.email,
					name: userInfo.displayName,
					...properties,
					alias: distinctId,
				},
			})
			// Ensure distinct ID is updated so that we will not identify the user again
			setDistinctId(userInfo.id)
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
}
