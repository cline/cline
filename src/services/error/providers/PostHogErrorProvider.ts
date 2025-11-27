import { PostHog } from "posthog-node"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { getDistinctId } from "@/services/logging/distinctId"
import { PostHogClientProvider } from "@/services/telemetry/providers/posthog/PostHogClientProvider"
import { Setting } from "@/shared/proto/index.host"
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

	constructor(clientConfig: PostHogClientValidConfig) {
		// Use shared PostHog client if provided, otherwise create a new one
		this.client = new PostHog(clientConfig.errorTrackingApiKey, {
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
	}

	public async initialize(): Promise<PostHogErrorProvider> {
		// Listen for host telemetry changes
		HostProvider.env.subscribeToTelemetrySettings(
			{},
			{
				onResponse: (event: { isEnabled: Setting }) => {
					const hostEnabled = event.isEnabled === Setting.ENABLED || event.isEnabled === Setting.UNSUPPORTED
					this.errorSettings.hostEnabled = hostEnabled
				},
			},
		)

		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			this.errorSettings.hostEnabled = false
		}

		// Check extension-specific telemetry setting
		const config = vscode.workspace.getConfiguration("cline")
		if (config.get("telemetrySetting") === "disabled") {
			this.errorSettings.enabled = false
		}

		this.errorSettings.level = await this.getErrorLevel()
		return this
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

	private async getErrorLevel(): Promise<ErrorSettings["level"]> {
		const hostSettings = await HostProvider.env.getTelemetrySettings({})
		if (hostSettings.isEnabled === Setting.DISABLED) {
			return "off"
		}
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<ErrorSettings["level"]>("telemetryLevel") || "all"
	}

	private get distinctId(): string {
		return getDistinctId()
	}

	public async dispose(): Promise<void> {
		// Only shut down the client if it's not shared (we own it)
		if (!this.isSharedClient) {
			await this.client.shutdown().catch((error) => console.error("Error shutting down PostHog client:", error))
		}
	}
}
