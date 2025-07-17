export type Environment = "production" | "staging" | "local"

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
	local: {
		appBaseUrl: "http://localhost:3000",
	},
}

export const clineEnvConfig = configs[CURRENT_ENVIRONMENT]
