import type { FeatureFlagsAndPayloads, FeatureFlagsContext, FeatureFlagsSettings, IFeatureFlagsProvider } from "@cline/core"
import { PostHog } from "posthog-node"
import { getDistinctId } from "@/services/logging/distinctId"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { posthogConfig } from "../../../shared/services/config/posthog-config"

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
				fetch: (url, options) => fetch(url, options),
			})
		}

		// Initialize feature flags settings
		this.settings = {
			enabled: true,
			timeoutMs: 5000, // 5 second timeout for feature flag requests
		}
	}

	async getAllFlagsAndPayloads(options: {
		flagKeys?: readonly string[]
		context: FeatureFlagsContext
	}): Promise<FeatureFlagsAndPayloads | undefined> {
		if (!this.enabled) {
			return undefined
		}

		try {
			const distinctId = options.context.userId?.trim() || options.context.distinctId?.trim() || getDistinctId()
			return await this.client.getAllFlagsAndPayloads(distinctId, {
				flagKeys: options.flagKeys ? [...options.flagKeys] : undefined,
			})
		} catch (error) {
			Logger.error(`Error getting feature flags`, error)
			return {}
		}
	}

	public get enabled(): boolean {
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
				Logger.error("Error shutting down PostHog client:", error)
			}
		}
	}
}
