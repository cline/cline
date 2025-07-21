import { PostHog } from "posthog-node"
import { posthogConfig } from "../../shared/services/config/posthog-config"

class PostHogClientProvider {
	private static instance: PostHogClientProvider
	private client: PostHog

	private constructor() {
		this.client = new PostHog(posthogConfig.apiKey, {
			host: posthogConfig.host,
			enableExceptionAutocapture: false,
		})
	}

	public static getInstance(): PostHogClientProvider {
		if (!PostHogClientProvider.instance) {
			PostHogClientProvider.instance = new PostHogClientProvider()
		}
		return PostHogClientProvider.instance
	}

	public getClient(): PostHog {
		return this.client
	}

	public async shutdown(): Promise<void> {
		await this.client.shutdown()
	}
}

export const posthogClientProvider = PostHogClientProvider.getInstance()
