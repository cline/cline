import { PostHog } from "posthog-node"
import * as vscode from "vscode"
import { getDistinctId } from "@/services/logging/distinctId"
import { PostHogClientProvider } from "@/services/posthog/PostHogClientProvider"
import * as pkg from "../../../../package.json"
import { PostHogClientValidConfig } from "../../../shared/services/config/posthog-config"
import { ClineError } from "../ClineError"
import type { ErrorSettings, IErrorProvider } from "./IErrorProvider"

const isDev = process.env.IS_DEV === "true"

/**
 * PostHog implementation of the error provider interface
 * Handles PostHog-specific error tracking and logging
 */
export class PostHogErrorProvider implements IErrorProvider {
	private client: PostHog
	private errorSettings: ErrorSettings
	// Does not accept shared client
	private readonly isSharedClient = false
	private disposables: vscode.Disposable[] = []

	constructor(clientConfig: PostHogClientValidConfig) {
		// Use shared PostHog client if provided, otherwise create a new one
		this.client = new PostHog(clientConfig.apiKey, {
			host: clientConfig.host,
			enableExceptionAutocapture: false, // NOTE: Re-enable it once the api key is set to env var
			before_send: (event) => PostHogClientProvider.eventFilter(event),
		})

		// Initialize error settings
		this.errorSettings = {
			enabled: true,
			hostEnabled: true,
			level: "all",
		}

		// Listen for VS Code telemetry changes
		this.disposables.push(
			vscode.env.onDidChangeTelemetryEnabled((isTelemetryEnabled) => {
				this.errorSettings.hostEnabled = isTelemetryEnabled
			}),
		)

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

	private getErrorLevel(): ErrorSettings["level"] {
		if (!vscode?.env?.isTelemetryEnabled) {
			return "off"
		}
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<ErrorSettings["level"]>("telemetryLevel") || "all"
	}

	private get distinctId(): string {
		return getDistinctId()
	}

	public async dispose(): Promise<void> {
		// Dispose of all disposables
		this.disposables.forEach((disposable) => disposable.dispose())
		// Only shut down the client if it's not shared (we own it)
		if (!this.isSharedClient) {
			await this.client.shutdown().catch((error) => console.error("Error shutting down PostHog client:", error))
		}
	}
}
