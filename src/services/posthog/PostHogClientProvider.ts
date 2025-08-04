import { PostHog } from "posthog-node"
import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"
import { posthogConfig } from "../../shared/services/config/posthog-config"
import type { ClineAccountUserInfo } from "../auth/AuthService"
import { ErrorService } from "../error/ErrorService"
import { FeatureFlagsService } from "./feature-flags/FeatureFlagsService"
import { TelemetryService } from "./telemetry/TelemetryService"

const ENV_ID = vscode?.env?.machineId ?? process?.env?.UUID ?? uuidv4()

interface TelemetrySettings {
	cline: boolean
	host: boolean
	level?: "all" | "off" | "error" | "crash"
}

export class PostHogClientProvider {
	private static _instance: PostHogClientProvider | null = null

	public static getInstance(id?: string): PostHogClientProvider {
		if (!PostHogClientProvider._instance) {
			PostHogClientProvider._instance = new PostHogClientProvider(id)
		}
		return PostHogClientProvider._instance
	}

	protected telemetrySettings: TelemetrySettings = {
		cline: true,
		host: true,
		level: "all",
	}

	public readonly client: PostHog

	public readonly featureFlags: FeatureFlagsService
	public readonly telemetry: TelemetryService
	public readonly error: ErrorService

	private constructor(public distinctId = ENV_ID) {
		// Initialize PostHog client
		this.client = new PostHog(posthogConfig.apiKey, {
			host: posthogConfig.host,
			enableExceptionAutocapture: true,
		})

		vscode.env.onDidChangeTelemetryEnabled((isTelemetryEnabled) => {
			this.telemetrySettings.host = isTelemetryEnabled
		})

		if (vscode?.env?.isTelemetryEnabled === false) {
			this.telemetrySettings.host = false
		}

		const config = vscode.workspace.getConfiguration("cline")
		if (config.get("telemetrySetting") === "disabled") {
			this.telemetrySettings.cline = false
		}

		this.telemetrySettings.level = this.telemetryLevel

		// Initialize services
		this.telemetry = new TelemetryService(this)
		this.error = new ErrorService(this, this.distinctId)
		this.featureFlags = new FeatureFlagsService(
			(flag: string) => this.client.getFeatureFlag(flag, this.distinctId),
			(flag: string) => this.client.getFeatureFlagPayload(flag, this.distinctId),
		)
	}

	private get isTelemetryEnabled(): boolean {
		return this.telemetrySettings.cline && this.telemetrySettings.host
	}

	/** Whether telemetry is currently enabled based on user and VSCode settings */
	private get telemetryLevel(): TelemetrySettings["level"] {
		if (!vscode?.env?.isTelemetryEnabled) {
			return "off"
		}
		const config = vscode.workspace.getConfiguration("telemetry")
		return config?.get<TelemetrySettings["level"]>("telemetryLevel") || "all"
	}

	public toggleOptIn(optIn: boolean): void {
		if (optIn && !this.telemetrySettings.cline) {
			this.client.optIn()
		}
		if (!optIn && this.telemetrySettings.cline) {
			this.client.optOut()
		}
		this.telemetrySettings.cline = optIn
	}

	/**
	 * Identifies the accounts user
	 * If userInfo is provided, it will use that to identify the user.
	 * Otherwise, it will use the DISTINCT_ID as the distinct ID.
	 * @param userInfo The user's information
	 */
	public identifyAccount(userInfo?: ClineAccountUserInfo, properties: Record<string, unknown> = {}): void {
		if (!this.isTelemetryEnabled) {
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

	public log(event: string, properties?: Record<string, unknown>): void {
		if (!this.isTelemetryEnabled || this.telemetryLevel === "off") {
			return
		}
		// Filter events based on telemetry level
		if (this.telemetryLevel === "error") {
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

	public dispose(): void {
		this.client.shutdown().catch((error) => console.error("Error shutting down PostHog client:", error))
	}
}

const getFeatureFlagsService = (): FeatureFlagsService => PostHogClientProvider.getInstance().featureFlags
const getErrorService = (): ErrorService => PostHogClientProvider.getInstance().error
const getTelemetryService = (): TelemetryService => PostHogClientProvider.getInstance().telemetry

// Service accessors
export const featureFlagsService = getFeatureFlagsService()
export const errorService = getErrorService()
export const telemetryService = getTelemetryService()
