import { PostHog } from "posthog-node"
import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"
import { posthogConfig } from "../../shared/services/config/posthog-config"
import type { ClineAccountUserInfo } from "../auth/AuthService"
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

	private static _distinctId: string

	public static get distinctId(): string {
		return PostHogClientProvider._distinctId
	}

	private constructor(uid?: string) {
		const distinctId = uid || ENV_UID
		PostHogClientProvider._distinctId = distinctId
		// Initialize PostHog client
		this.client = new PostHog(posthogConfig.apiKey, {
			host: posthogConfig.host,
			enableExceptionAutocapture: false,
		})

		// Initialize services
		this.featureFlags = new FeatureFlagsService(this.client, distinctId)
		this.telemetry = new TelemetryService(this, distinctId)
		this.error = new ErrorService(this, distinctId)

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
		const config = vscode.workspace.getConfiguration("cline")
		this.cachedTelemetryLevel = config?.get<string>("telemetryLevel") || "all"
	}

	private get telemetryLevel(): string {
		const cached = this.cachedTelemetryLevel
		return cached === "crash" || cached === "error" ? "error" : cached || "all"
	}

	/**
	 * Gets or creates the singleton instance
	 */
	public static getInstance(uid?: string): PostHogClientProvider {
		if (!PostHogClientProvider.instance) {
			PostHogClientProvider.instance = new PostHogClientProvider(uid)
		}
		return PostHogClientProvider.instance
	}

	/**
	 * Checks if instance exists
	 */
	public isActive(): boolean {
		return PostHogClientProvider.instance !== null
	}

	public toggleOptIn(optIn: boolean): void {
		if (optIn) {
			this.client.optIn()
		} else {
			this.client.optOut()
		}
		this.identifyAccount()
	}

	/**
	 * Identifies the accounts user
	 * If userInfo is provided, it will use that to identify the user.
	 * Otherwise, it will use the ENV_UID as the distinct ID.
	 * @param userInfo The user's information
	 */
	public identifyAccount(
		userInfo?: ClineAccountUserInfo,
		properties: Record<string, any> = {},
		distinctId = PostHogClientProvider.distinctId,
	): void {
		if (!vscode?.env?.isTelemetryEnabled || this.isShuttingDown) {
			return
		}

		if (!PostHogClientProvider.instance?.isActive()) {
			console.warn("Telemetry client not initialized to identifyAccount.")
			return
		}

		if (userInfo?.id) {
			this.client.identify({
				distinctId: userInfo.id,
				properties: {
					uuid: userInfo.id,
					email: userInfo.email,
					name: userInfo.displayName,
					...properties,
				},
			})
			return
		}

		this.client.identify({ distinctId })
	}

	public log(event: string, properties?: Record<string, any>): void {
		console.info(`PostHog Logging event: ${event}`, properties)
		if (!vscode?.env?.isTelemetryEnabled || this.isShuttingDown) {
			return
		}
		if (!PostHogClientProvider.instance?.isActive()) {
			console.warn("PostHogClientProvider is not active..")
			return
		}
		// Filter events based on telemetry level
		if (event.includes("error") && this.telemetryLevel !== "error" && this.telemetryLevel !== "all") {
			return
		}

		this.client.capture({
			distinctId: PostHogClientProvider.distinctId,
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
export const distinctId = PostHogClientProvider.distinctId
