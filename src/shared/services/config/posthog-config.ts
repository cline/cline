// Public PostHog key (safe for open source)
const posthogProdConfig = {
	apiKey: process?.env?.POSTHOG_PROD_API_KEY,
	host: "https://data.cline.bot",
	uiHost: "https://us.posthog.com",
}

// Public PostHog key for Development Environment project
const posthogDevEnvConfig = {
	apiKey: process?.env?.POSTHOG_DEV_API_KEY,
	host: "https://data.cline.bot",
	uiHost: "https://us.i.posthog.com",
}

export const posthogConfig = process.env.IS_DEV === "true" ? posthogDevEnvConfig : posthogProdConfig
