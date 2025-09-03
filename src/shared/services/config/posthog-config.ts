export interface PostHogClientConfig {
	/**
	 * The main API key for PostHog telemetry service.
	 */
	apiKey?: string | undefined
	/**
	 * The API key for PostHog used only for error tracking service.
	 */
	errorTrackingApiKey?: string | undefined
	host: string
	uiHost: string
}

/**
 * Helper type for a valid PostHog client configuration.
 * Must contains api keys for both telemetry and error tracking.
 */
export interface PostHogClientValidConfig extends PostHogClientConfig {
	apiKey: string
	errorTrackingApiKey: string
}

/**
 * Public PostHog keys for prod and dev (safe for open source).
 * NOTE: Soon to be deprecated and replaced with environment variables.
 */
const PUBLIC_POSTHOG_API_KEYS = {
	PROD: "phc_qfOAGxZw2TL5O8p9KYd9ak3bPBFzfjC8fy5L6jNWY7K",
	DEV: "phc_uY24EJXNBcc9kwO1K8TJUl5hPQntGM6LL1Mtrz0CBD4",
}

/**
 * PostHog configuration for Production Environment.
 * NOTE: The production environment variables will be injected at build time in CI/CD pipeline.
 * IMPORTANT: The secrets must be added to the GitHub Secrets and matched with the environment variables names
 * defined in the .github/workflows/publish.yml workflow.
 */
const POSTHOG_CONFIG_PROD = {
	apiKey: process?.env?.POSTHOG_API_KEY || PUBLIC_POSTHOG_API_KEYS.PROD,
	errorTrackingApiKey: process?.env?.POSTHOG_ERROR_API_KEY || PUBLIC_POSTHOG_API_KEYS.PROD,
	host: "https://data.cline.bot",
	uiHost: "https://us.posthog.com",
} satisfies PostHogClientConfig

/**
 * PostHog configuration for Development Environment project
 * NOTE: The development environment variables should be retrieved from 1password shared vault.
 */
const POSTHOG_CONFIG_DEV = {
	apiKey: process?.env?.POSTHOG_API_KEY_DEV || PUBLIC_POSTHOG_API_KEYS.DEV,
	errorTrackingApiKey: process?.env?.POSTHOG_ERROR_API_KEY_DEV || PUBLIC_POSTHOG_API_KEYS.DEV,
	host: "https://data.cline.bot",
	uiHost: "https://us.i.posthog.com",
} satisfies PostHogClientConfig

/**
 * NOTE: Ensure that dev environment is only used in CI or local dev, never in production.
 */
const isDevEnv = Boolean(process?.env?.CI || process?.env?.IS_DEV === "true")
export const posthogConfig = isDevEnv ? POSTHOG_CONFIG_DEV : POSTHOG_CONFIG_PROD
