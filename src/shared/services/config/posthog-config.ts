// Public PostHog key (safe for open source)
const posthogProdConfig = {
	apiKey: "phc_qfOAGxZw2TL5O8p9KYd9ak3bPBFzfjC8fy5L6jNWY7K",
	host: "https://data.cline.bot",
	uiHost: "https://us.posthog.com",
}

// Public PostHog key for Development Environment project
const posthogDevEnvConfig = {
	apiKey: "phc_uY24EJXNBcc9kwO1K8TJUl5hPQntGM6LL1Mtrz0CBD4",
	host: "https://data.cline.bot",
	uiHost: "https://us.i.posthog.com",
}

export const posthogConfig = process.env.IS_DEV === "true" ? posthogDevEnvConfig : posthogProdConfig
