export enum Environment {
	production = "production",
	staging = "staging",
	local = "local",
}

interface EnvironmentConfig {
	appBaseUrl: string
	apiBaseUrl: string
	mcpBaseUrl: string
	firebase: {
		apiKey: string
		authDomain: string
		projectId: string
		storageBucket?: string
		messagingSenderId?: string
		appId?: string
	}
}

function getClineEnv(): Environment {
	const _env = process?.env?.CLINE_ENVIRONMENT
	if (_env && Object.values(Environment).includes(_env as Environment)) {
		return _env as Environment
	}
	return Environment.production
}

// Config getter function to avoid storing all configs in memory
function getEnvironmentConfig(env: Environment): EnvironmentConfig {
	switch (env) {
		case Environment.staging:
			return {
				appBaseUrl: "https://staging-app.cline.bot",
				apiBaseUrl: "https://core-api.staging.int.cline.bot",
				mcpBaseUrl: "https://api.cline.bot/v1/mcp",
				firebase: {
					apiKey: "AIzaSyASSwkwX1kSO8vddjZkE5N19QU9cVQ0CIk",
					authDomain: "cline-staging.firebaseapp.com",
					projectId: "cline-staging",
					storageBucket: "cline-staging.firebasestorage.app",
					messagingSenderId: "853479478430",
					appId: "1:853479478430:web:2de0dba1c63c3262d4578f",
				},
			}
		case Environment.local:
			return {
				appBaseUrl: "http://localhost:3000",
				apiBaseUrl: "http://localhost:7777",
				mcpBaseUrl: "https://api.cline.bot/v1/mcp",
				firebase: {
					apiKey: "AIzaSyD8wtkd1I-EICuAg6xgAQpRdwYTvwxZG2w",
					authDomain: "cline-preview.firebaseapp.com",
					projectId: "cline-preview",
				},
			}
		default:
			return {
				appBaseUrl: "https://app.cline.bot",
				apiBaseUrl: "https://api.cline.bot",
				mcpBaseUrl: "https://api.cline.bot/v1/mcp",
				firebase: {
					apiKey: "AIzaSyC5rx59Xt8UgwdU3PCfzUF7vCwmp9-K2vk",
					authDomain: "cline-prod.firebaseapp.com",
					projectId: "cline-prod",
					storageBucket: "cline-prod.firebasestorage.app",
					messagingSenderId: "941048379330",
					appId: "1:941048379330:web:45058eedeefc5cdfcc485b",
				},
			}
	}
}

// Get environment once at module load
const CLINE_ENVIRONMENT = getClineEnv()
const _configCache = getEnvironmentConfig(CLINE_ENVIRONMENT)

console.info("Cline environment:", CLINE_ENVIRONMENT)

export const clineEnvConfig = _configCache
