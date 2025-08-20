import { PostHog } from "posthog-node"
import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"
import { posthogConfig } from "../../shared/services/config/posthog-config"
import { getErrorService } from "../error"
import { ErrorService } from "../error/ErrorService"
import { FeatureFlagsService } from "../feature-flags/FeatureFlagsService"
import { PostHogFeatureFlagsProvider } from "../feature-flags/providers/PostHogFeatureFlagsProvider"
import { PostHogTelemetryProvider } from "../telemetry/providers/PostHogTelemetryProvider"
import { TelemetryService } from "../telemetry/TelemetryService"

// Prefer host-provided UUID when running via HostBridge; fall back to VS Code's machineId, then a random UUID
const ENV_ID = process?.env?.UUID ?? vscode?.env?.machineId ?? uuidv4()

export class PostHogClientProvider {
	private static _instance: PostHogClientProvider | null = null

	public static getInstance(id?: string): PostHogClientProvider {
		if (!PostHogClientProvider._instance) {
			PostHogClientProvider._instance = new PostHogClientProvider(id)
		}
		return PostHogClientProvider._instance
	}

	public readonly client: PostHog

	public readonly featureFlags: FeatureFlagsService
	public readonly telemetry: TelemetryService
	public readonly error: ErrorService

	private constructor(public distinctId = ENV_ID) {
		// Initialize PostHog client
		this.client = new PostHog(posthogConfig.apiKey, {
			host: posthogConfig.host,
		})

		// Initialize services using the shared PostHog client
		const telemetryProvider = new PostHogTelemetryProvider(this.distinctId, this.client)
		this.telemetry = new TelemetryService(telemetryProvider)

		const featureFlagsProvider = new PostHogFeatureFlagsProvider(this.distinctId, this.client)
		this.featureFlags = new FeatureFlagsService(featureFlagsProvider)

		this.error = getErrorService(this.distinctId)
	}

	/**
	 * Get the PostHog client instance for direct access
	 * @returns PostHog client instance
	 */
	public getClient(): PostHog {
		return this.client
	}

	/**
	 * Get the current distinct ID
	 * @returns Current distinct ID
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

	public async dispose(): Promise<void> {
		await Promise.all([
			this.client.shutdown().catch((error) => console.error("Error shutting down PostHog client:", error)),
			this.telemetry.dispose(),
			this.error.dispose(),
			this.featureFlags.dispose(),
		])
	}
}
