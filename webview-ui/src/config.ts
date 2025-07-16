export type Environment = "production" | "staging" | "preview"

const CURRENT_ENVIRONMENT: Environment = "production"

interface EnvironmentConfig {
	appBaseUrl: string
}

const configs: Record<Environment, EnvironmentConfig> = {
	production: {
		appBaseUrl: "https://app.cline.bot",
	},
	staging: {
		appBaseUrl: "https://staging-app.cline.bot",
	},
	preview: {
		appBaseUrl: "http://localhost:3000",
	},
}

export const config = configs[CURRENT_ENVIRONMENT]
