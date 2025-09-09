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
	apiKey: "phc_qfOAGxZw2TL5O8p9KYd9ak3bPBFzfjC8fy5L6jNWY7K",
	errorTrackingApiKey: "phc_qfOAGxZw2TL5O8p9KYd9ak3bPBFzfjC8fy5L6jNWY7K",
	host: "https://data.cline.bot",
	uiHost: "https://us.posthog.com",
} satisfies PostHogClientConfig

// Public PostHog key for Development Environment project
const posthogDevEnvConfig = {
	apiKey: "phc_uY24EJXNBcc9kwO1K8TJUl5hPQntGM6LL1Mtrz0CBD4",
	errorTrackingApiKey: "phc_uY24EJXNBcc9kwO1K8TJUl5hPQntGM6LL1Mtrz0CBD4",
	host: "https://data.cline.bot",
	uiHost: "https://us.i.posthog.com",
} satisfies PostHogClientConfig

// NOTE: Ensure that dev environment is used when process.env.IS_DEV is "true"
export const posthogConfig = process.env.IS_DEV === "true" ? posthogDevEnvConfig : posthogProdConfig
