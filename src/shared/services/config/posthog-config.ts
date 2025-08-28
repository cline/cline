export interface PostHogClientConfig {
	apiKey?: string | undefined
	errorTrackingApiKey?: string | undefined
	host: string
	uiHost: string
}

export interface PostHogClientValidConfig extends PostHogClientConfig {
	apiKey: string
	errorTrackingApiKey: string
}

// Public PostHog key (safe for open source)
const posthogProdConfig = {
	apiKey: process?.env?.POSTHOG_PROD_API_KEY,
	errorTrackingApiKey: process?.env?.POSTHOG_PROD_ERROR_TRACKING_API_KEY,
	host: "https://data.cline.bot",
	uiHost: "https://us.posthog.com",
} satisfies PostHogClientConfig

// Public PostHog key for Development Environment project
const posthogDevEnvConfig = {
	apiKey: process?.env?.POSTHOG_DEV_API_KEY,
	errorTrackingApiKey: process?.env?.POSTHOG_DEV_ERROR_TRACKING_API_KEY,
	host: "https://data.cline.bot",
	uiHost: "https://us.i.posthog.com",
} satisfies PostHogClientConfig

export const posthogConfig = process.env.IS_DEV === "true" ? posthogDevEnvConfig : posthogProdConfig
