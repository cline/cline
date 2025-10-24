export enum Environment {
	production = "production",
	staging = "staging",
	local = "local",
}

export interface EnvironmentConfig {
	environment: Environment
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

class ClineEndpoint {
	public static instance = new ClineEndpoint()
	public static get config() {
		return ClineEndpoint.instance.config()
	}

	private environment: Environment = Environment.production

	private constructor() {
		// Set environment at module load
		const _env = process?.env?.CLINE_ENVIRONMENT
		if (_env && Object.values(Environment).includes(_env as Environment)) {
			this.environment = _env as Environment
			return
		}
	}

	public config(): EnvironmentConfig {
		return this.getEnvironment()
	}

	public setEnvironment(env: string) {
		switch (env.toLowerCase()) {
			case "staging":
				this.environment = Environment.staging
				break
			case "local":
				this.environment = Environment.local
				break
			default:
				this.environment = Environment.production
				break
		}
		console.info("Cline environment updated: ", this.environment)
	}

	public getEnvironment(): EnvironmentConfig {
		switch (this.environment) {
			case Environment.staging:
				return {
					environment: Environment.staging,
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
					environment: Environment.local,
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
					environment: Environment.production,
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
}

/**
 * Singleton instance to access the current environment configuration.
 * Usage:
 * - ClineEnv.config() to get the current config.
 * - ClineEnv.setEnvironment(Environment.local) to change the environment.
 */
export const ClineEnv = ClineEndpoint.instance
