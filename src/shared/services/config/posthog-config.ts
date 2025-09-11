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
 * NOTE: Ensure that dev environment is not used in production.
 * process.env.CI will always be true in the CI environment, during both testing and publishing step,
 * so it is not a reliable indicator of the environment.
 */
const useDevEnv = process?.env?.IS_DEV === "true" || process?.env?.CLINE_ENVIRONMENT === "local"

/**
 * Soon to be deprecated hardcoded keys for PostHog.
 */
const TO_BE_DEPRECATED = {
	production: "phc_qfOAGxZw2TL5O8p9KYd9ak3bPBFzfjC8fy5L6jNWY7K",
	dev: "phc_uY24EJXNBcc9kwO1K8TJUl5hPQntGM6LL1Mtrz0CBD4",
}
/**
 * NOTE: Will be deprecated once we have set up the environment variables in CI/CD pipeline.
 */
const DEPRECATED_KEY = useDevEnv ? TO_BE_DEPRECATED.dev : TO_BE_DEPRECATED.production

/**
 * PostHog configuration for Production Environment.
 * NOTE: The production environment variables will be injected at build time in CI/CD pipeline.
 * IMPORTANT: The secrets must be added to the GitHub Secrets and matched with the environment variables names
 * defined in the .github/workflows/publish.yml workflow.
 * NOTE: The development environment variables should be retrieved from 1password shared vault.
 */
export const posthogConfig: PostHogClientConfig = {
	apiKey: process?.env?.TELEMETRY_SERVICE_API_KEY || DEPRECATED_KEY,
	errorTrackingApiKey: process?.env?.ERROR_SERVICE_API_KEY || DEPRECATED_KEY,
	host: "https://data.cline.bot",
	uiHost: useDevEnv ? "https://us.i.posthog.com" : "https://us.posthog.com",
}

const isTestEnv = process?.env?.E2E_TEST === "true" || process?.env?.IS_TEST === "true"

export function isPostHogConfigValid(config: PostHogClientConfig): config is PostHogClientValidConfig {
	// Allow invalid config in test environment to enable mocking and stubbing
	if (isTestEnv) {
		return false
	}
	return (
		typeof config.apiKey === "string" &&
		typeof config.errorTrackingApiKey === "string" &&
		typeof config.host === "string" &&
		typeof config.uiHost === "string"
	)
}
