import { EventMessage, PostHog } from "posthog-node"
import { posthogConfig } from "../../shared/services/config/posthog-config"

export class PostHogClientProvider {
	private static _instance: PostHogClientProvider | null = null

	public static getInstance(): PostHogClientProvider {
		if (!PostHogClientProvider._instance) {
			PostHogClientProvider._instance = new PostHogClientProvider()
		}
		return PostHogClientProvider._instance
	}

	public static getClient(): PostHog | null {
		return PostHogClientProvider.getInstance().client
	}

	private readonly client: PostHog | null

	private constructor() {
		// Initialize PostHog client
		this.client = posthogConfig.apiKey
			? new PostHog(posthogConfig.apiKey, {
					host: posthogConfig.host,
					enableExceptionAutocapture: false, // This is only enabled for error services
					before_send: (event) => PostHogClientProvider.eventFilter(event),
				})
			: null
	}

	/**
	 * Filters PostHog events before they are sent.
	 * For exceptions, we only capture those from the Cline extension.
	 */
	static eventFilter(event: EventMessage | null) {
		if (!event || event?.event !== "$exception") {
			return event
		}
		const exceptionList = event.properties?.["$exception_list"]
		if (!exceptionList?.length) {
			return null
		}
		// Check if any exception is from Cline
		for (let i = 0; i < exceptionList.length; i++) {
			const stacktrace = exceptionList[i].stacktrace
			// Fast check: error message contains "cline"
			if (stacktrace?.value?.toLowerCase().includes("cline")) {
				return event
			}
			// Check stack frames for Cline extension path
			const frames = stacktrace?.frames
			if (frames?.length) {
				for (let j = 0; j < frames.length; j++) {
					if (frames[j]?.filename?.includes("saoudrizwan")) {
						return event
					}
				}
			}
		}
		return null
	}

	public async dispose(): Promise<void> {
		await this.client?.shutdown().catch((error) => console.error("Error shutting down PostHog client:", error))
	}
}
