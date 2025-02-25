import { PostHog } from "posthog-node"
import * as vscode from "vscode"

const apiKey = "phc_5WnLHpYyC30Bsb7VSJ6DzcPXZ34JSF08DJLyM7svZ15"
const apiHost = "https://us.i.posthog.com"

class PostHogClient {
	private static instance: PostHogClient
	private client: PostHog
	private distinctId: string = vscode.env.machineId

	private constructor() {
		this.client = new PostHog(apiKey, {
			host: apiHost,
			enableExceptionAutocapture: true,
		})
	}

	public static getInstance(): PostHogClient {
		if (!PostHogClient.instance) {
			PostHogClient.instance = new PostHogClient()
		}
		return PostHogClient.instance
	}

	public optIn(): void {
		this.client.identify({ distinctId: this.distinctId })
		this.client.optIn()
	}

	public optOut(): void {
		this.client.optOut()
	}

	public capture(event: { event: string; properties?: any }): void {
		this.client.capture({ distinctId: this.distinctId, event: event.event, properties: event.properties })
	}

	public async shutdown(): Promise<void> {
		await this.client.shutdown()
	}
}

// Export a single instance
export default PostHogClient.getInstance()
