import { Laminar } from "@lmnr-ai/lmnr"
import { isLaminarConfigValid, laminarConfig } from "@/shared/services/config/laminar-config"

/**
 * Singleton provider for Laminar client instance.
 * Handles initialization and lifecycle of the Laminar SDK client.
 */
export class LaminarClientProvider {
	private static _instance: LaminarClientProvider | null = null

	public static getInstance(): LaminarClientProvider {
		if (!LaminarClientProvider._instance) {
			LaminarClientProvider._instance = new LaminarClientProvider()
		}
		return LaminarClientProvider._instance
	}

	public static isInitialized(): boolean {
		return LaminarClientProvider.getInstance().isInitialized
	}

	private isInitialized: boolean = false

	private constructor() {
		// Only initialize if we have a valid API key
		if (!isLaminarConfigValid(laminarConfig)) {
			console.log("[Laminar] API key not found. Laminar observability will be disabled.")
			return
		}

		try {
			Laminar.initialize({
				projectApiKey: laminarConfig.apiKey,
			})
			this.isInitialized = true
			console.info("[Laminar] Client initialized successfully")
		} catch (error) {
			console.error(`[Laminar] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	public async dispose(): Promise<void> {
		if (!this.isInitialized) {
			return
		}

		try {
			await Laminar.shutdown()
		} catch (error) {
			console.error("Error shutting down Laminar client:", error)
		}
	}
}

