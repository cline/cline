import { PostHog } from "posthog-node"
import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"
import { posthogConfig } from "../../shared/services/config/posthog-config"
import { ErrorService } from "../error/ErrorService"
import { FeatureFlagsService } from "./feature-flags/FeatureFlagsService"
import { TelemetryService } from "./telemetry/TelemetryService"

export const ENV_UID = vscode?.env?.machineId ?? uuidv4()

export class PostHogClientProvider {
	private static instance: PostHogClientProvider | null = null

	public readonly client: PostHog
	public readonly featureFlags: FeatureFlagsService
	public readonly telemetry: TelemetryService
	public readonly error: ErrorService

	private cachedTelemetryLevel: string | null = null
	private isShuttingDown = false

	private constructor() {
		// Initialize PostHog client
		this.client = new PostHog(posthogConfig.apiKey, {
			host: posthogConfig.host,
			enableExceptionAutocapture: false,
		})

		// Initialize services
		this.featureFlags = new FeatureFlagsService(this.client)
		this.telemetry = new TelemetryService(this)
		this.error = new ErrorService(this)

		// Set up telemetry change listener
		vscode.env.onDidChangeTelemetryEnabled((isTelemetryEnabled) => {
			if (!isTelemetryEnabled) {
				this.log("telemetry_disabled")
			}
		})

		// Cache initial telemetry level
		this.updateTelemetryLevel()

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("cline.telemetryLevel")) {
				this.updateTelemetryLevel()
			}
		})
	}

	private updateTelemetryLevel(): void {
		this.cachedTelemetryLevel = vscode.workspace.getConfiguration("cline").get<string>("telemetryLevel") || "error"
	}

	private get telemetryLevel(): string {
		return this.cachedTelemetryLevel || "all"
	}

	/**
	 * Gets or creates the singleton instance
	 */
	public static getInstance(): PostHogClientProvider {
		if (!PostHogClientProvider.instance) {
			PostHogClientProvider.instance = new PostHogClientProvider()
		}
		return PostHogClientProvider.instance
	}

	/**
	 * Checks if instance exists
	 */
	public static isActive(): boolean {
		return PostHogClientProvider.instance !== null
	}

	public log(event: string, properties?: Record<string, any>): void {
		console.info(`PostHog Logging event: ${event}`, properties)
		if (!PostHogClientProvider.isActive()) {
			console.warn("PostHogClientProvider is not active, cannot log event:", event)
			return
		}
		if (!vscode?.env?.isTelemetryEnabled || this.isShuttingDown) {
			console.log("Telemetry is disabled or client is shutting down, skipping log:", event)
			return
		}

		if (event.includes("error") && this.telemetryLevel !== "error") {
			return
		}

		this.client.capture({
			distinctId: ENV_UID,
			event,
			properties,
		})
	}

	public async shutdown(): Promise<void> {
		if (this.isShuttingDown) {
			return
		}

		this.isShuttingDown = true

		try {
			await Promise.all([this.client.shutdown(), this.telemetry.shutdown()])
		} catch (error) {
			console.error("Error shutting down PostHog client:", error)
		}
	}

	public dispose(): void {
		this.shutdown().catch(() => {
			// Silently handle shutdown errors in dispose
		})
	}
}

// Convenience functions
export function getPostHogClientProvider(): PostHogClientProvider {
	return PostHogClientProvider.getInstance()
}

// Service accessors
export const getFeatureFlagsService = (): FeatureFlagsService => PostHogClientProvider.getInstance().featureFlags

export const getTelemetryService = (): TelemetryService => PostHogClientProvider.getInstance().telemetry

export const getErrorService = (): ErrorService => PostHogClientProvider.getInstance().error

// Legacy exports for backward compatibility
export const featureFlagsService = getFeatureFlagsService()
export const telemetryService = getTelemetryService()
export const errorService = getErrorService()
