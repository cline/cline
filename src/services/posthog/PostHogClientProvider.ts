import { PostHog } from "posthog-node"
import { posthogConfig } from "../../shared/services/config/posthog-config"

export class PostHogClientProvider {
	private static _instance: PostHogClientProvider | null = null

	public static getInstance(): PostHogClientProvider {
		if (!PostHogClientProvider._instance) {
			PostHogClientProvider._instance = new PostHogClientProvider()
		}
		return PostHogClientProvider._instance
	}

	public static getClient(): PostHog {
		return PostHogClientProvider.getInstance().client
	}

	private readonly client: PostHog

	private constructor() {
		// Initialize PostHog client
		this.client = new PostHog(posthogConfig.apiKey, {
			host: posthogConfig.host,
		})
	}

	public async dispose(): Promise<void> {
		await this.client.shutdown().catch((error) => console.error("Error shutting down PostHog client:", error))
	}
}
