import { PostHog } from "posthog-node"
import { getDistinctId } from "@/services/logging/distinctId"
import { posthogConfig } from "../../../shared/services/config/posthog-config"
import type { FeatureFlagPayload, FeatureFlagsSettings, IFeatureFlagsProvider } from "./IFeatureFlagsProvider"

/**
 * PostHog implementation of the feature flags provider interface
 * Handles PostHog-specific feature flag retrieval
 */
export class PostHogFeatureFlagsProvider implements IFeatureFlagsProvider {
	private client: PostHog
	private settings: FeatureFlagsSettings
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

		// Initialize feature flags settings
		this.settings = {
			enabled: true,
			timeout: 5000, // 5 second timeout for feature flag requests
		}
	}

	private get distinctId(): string {
		return getDistinctId()
	}

	public async getFeatureFlag(flagName: string): Promise<boolean | string | undefined> {
		if (!this.isEnabled()) {
			return undefined
		}

		try {
			return await this.client.getFeatureFlag(flagName, this.distinctId)
		} catch (error) {
			console.error(`Error getting feature flag ${flagName}:`, error)
			return undefined
		}
	}

	public async getFeatureFlagPayload(flagName: string): Promise<FeatureFlagPayload | null> {
		if (!this.isEnabled()) {
			return null
		}

		try {
			return (await this.client.getFeatureFlagPayload(flagName, this.distinctId)) ?? null
		} catch (error) {
			console.error(`Error getting feature flag payload for ${flagName}:`, error)
			return null
		}
	}

	public isEnabled(): boolean {
		return this.settings.enabled
	}

	public getSettings(): FeatureFlagsSettings {
		return { ...this.settings }
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
}
