export interface JitsuClientConfig {
	/**
	 * The write key for Jitsu analytics service.
	 */
	writeKey?: string | undefined
	/**
	 * Jitsu host URL for data ingestion
	 */
	host: string
	/**
	 * Enable debug logging in browser console
	 */
	debug?: boolean
	/**
	 * Privacy settings for Jitsu
	 */
	privacy?: {
		dontSend?: boolean
		disableUserIds?: boolean
		ipPolicy?: "keep" | "stripLastOctet" | "remove"
	}
}

/**
 * Helper type for a valid Jitsu client configuration.
 */
export interface JitsuClientValidConfig extends JitsuClientConfig {
	writeKey: string
}

/**
 * Provider selection configuration
 */
export interface TelemetryProvidersConfig {
	jitsu: boolean
	posthog: boolean
}

const useDevEnv = process.env.IS_DEV === "true" || process.env.CLINE_ENVIRONMENT === "local"

/**
 * Jitsu configuration
 */
export const jitsuConfig: JitsuClientConfig = {
	writeKey: process.env.JITSU_WRITE_KEY,
	host: process.env.JITSU_HOST || "https://jitsu.cline.bot",
	debug: useDevEnv,
	privacy: {
		ipPolicy: "stripLastOctet", // Privacy-friendly by default
	},
}

/**
 * Provider selection configuration - easy enable/disable
 */
export const telemetryProvidersConfig: TelemetryProvidersConfig = {
	jitsu: process.env.JITSU_ENABLED !== "false", // Default enabled
	posthog: process.env.POSTHOG_TELEMETRY_ENABLED !== "false", // Easy disable by setting to "false"
}

const isTestEnv = process.env.E2E_TEST === "true" || process.env.IS_TEST === "true"

export function isJitsuConfigValid(config: JitsuClientConfig): config is JitsuClientValidConfig {
	// Allow invalid config in test environment to enable mocking and stubbing
	if (isTestEnv) {
		return false
	}
	return typeof config.writeKey === "string" && typeof config.host === "string"
}
