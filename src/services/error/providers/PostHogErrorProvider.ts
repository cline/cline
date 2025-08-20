import { PostHog } from "posthog-node"
import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"
import * as pkg from "../../../../package.json"
import { posthogConfig } from "../../../shared/services/config/posthog-config"
import { ClineError } from "../ClineError"
import type { ErrorSettings, IErrorProvider } from "../IErrorProvider"

// Prefer host-provided UUID when running via HostBridge; fall back to VS Code's machineId, then a random UUID
const ENV_ID = process?.env?.UUID ?? vscode?.env?.machineId ?? uuidv4()

const isDev = process.env.IS_DEV === "true"

/**
 * PostHog implementation of the error provider interface
 * Handles PostHog-specific error tracking and logging
 */
export class PostHogErrorProvider implements IErrorProvider {
	private client: PostHog
	private distinctId: string
	private errorSettings: ErrorSettings
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

		// Initialize error settings
		this.errorSettings = {
			enabled: true,
			hostEnabled: true,
			level: "all",
		}

		// Listen for VS Code telemetry changes
		vscode.env.onDidChangeTelemetryEnabled((isTelemetryEnabled) => {
			this.errorSettings.hostEnabled = isTelemetryEnabled
		})

		if (vscode?.env?.isTelemetryEnabled === false) {
			this.errorSettings.hostEnabled = false
		}

		// Check extension-specific telemetry setting
		const config = vscode.workspace.getConfiguration("cline")
		if (config.get("telemetrySetting") === "disabled") {
			this.errorSettings.enabled = false
		}

		this.errorSettings.level = this.getErrorLevel()
	}

	public logException(error: Error | ClineError, properties: Record<string, unknown> = {}): void {
		if (!this.isEnabled() || this.errorSettings.level === "off") {
			return
		}

		const errorDetails = {
			message: error.message,
			stack: error.stack,
			name: error.name,
			extension_version: pkg.version,
			is_dev: isDev,
			...properties,
		}

		if (error instanceof ClineError) {
			Object.assign(errorDetails, {
				modelId: error.modelId,
				providerId: error.providerId,
				serialized_error: error.serialize(),
			})
		}

		this.client.capture({
			distinctId: this.distinctId,
			event: "extension.error",
			properties: {
				error_type: "exception",
				...errorDetails,
				timestamp: new Date().toISOString(),
			},
		})

		console.error("[PostHogErrorProvider] Logging exception", error)
	}

	public logMessage(
		message: string,
		level: "error" | "warning" | "log" | "debug" | "info" = "log",
		properties: Record<string, unknown> = {},
	): void {
		if (!this.isEnabled() || this.errorSettings.level === "off") {
			return
		}

		// Filter messages based on error level
		if (this.errorSettings.level === "error" && level !== "error") {
			return
		}

		this.client.capture({
			distinctId: this.distinctId,
			event: "extension.message",
			properties: {
				message: message.substring(0, 500), // Truncate long messages
				level,
				extension_version: pkg.version,
				is_dev: isDev,
				timestamp: new Date().toISOString(),
				...properties,
			},
		})
	}

	public isEnabled(): boolean {
		return this.errorSettings.enabled && this.errorSettings.hostEnabled
	}

	public getSettings(): ErrorSettings {
		return { ...this.errorSettings }
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
	 * Get the current error logging level from VS Code settings
	 */
	private getErrorLevel(): ErrorSettings["level"] {
		if (!vscode?.env?.isTelemetryEnabled) {
			return "off"
		}
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<ErrorSettings["level"]>("telemetryLevel") || "all"
	}

	/**
	 * Get the distinct ID for this provider instance
	 */
	public getDistinctId(): string {
		return this.distinctId
	}

	/**
	 * Update the distinct ID
	 * @param newDistinctId New distinct ID to use
	 */
	public setDistinctId(newDistinctId: string): void {
		this.distinctId = newDistinctId
	}
}
