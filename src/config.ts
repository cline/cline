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
	modulesBaseUrl: string
	connectorsBaseUrl: string
	skillsBaseUrl: string
	firebase: {
		apiKey: string
		authDomain: string
		projectId: string
		storageBucket?: string
		messagingSenderId?: string
		appId?: string
	}
}

function getEnvOrDefault(name: string, fallback: string): string {
	const value = process?.env?.[name]
	return value && value.trim().length > 0 ? value : fallback
}

class AiHydroEndpoint {
	public static instance = new AiHydroEndpoint()
	public static get config() {
		return AiHydroEndpoint.instance.config()
	}

	private environment: Environment = Environment.production

	private constructor() {
		// Set environment at module load
		const _env = process?.env?.AIHYDRO_ENVIRONMENT
		if (_env && Object.values(Environment).includes(_env as Environment)) {
			this.environment = _env as Environment
			return
		}
		this.environment = Environment.production
	}

	public config(): EnvironmentConfig {
		console.info("AI-Hydro environment:", this.environment)
		return this.getEnvironment()
	}

	public setEnvironment(env: string) {
		console.info("Setting AI-Hydro environment:", env)
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
		console.info("AI-Hydro environment updated:", this.environment)
	}

	public getEnvironment(): EnvironmentConfig {
		switch (this.environment) {
			case Environment.staging:
				return {
					environment: Environment.staging,
					appBaseUrl: getEnvOrDefault("AI_HYDRO_APP_BASE_URL_STAGING", "https://github.com/AI-Hydro/AI-Hydro"),
					apiBaseUrl: getEnvOrDefault("AI_HYDRO_API_BASE_URL_STAGING", "http://127.0.0.1:7777"),
					mcpBaseUrl: getEnvOrDefault("AI_HYDRO_MCP_BASE_URL_STAGING", "https://ai-hydro.github.io/Marketplace/api"),
					modulesBaseUrl: getEnvOrDefault(
						"AI_HYDRO_MODULES_BASE_URL_STAGING",
						"https://ai-hydro.github.io/Modules/api",
					),
					connectorsBaseUrl: getEnvOrDefault(
						"AI_HYDRO_CONNECTORS_BASE_URL_STAGING",
						"https://ai-hydro.github.io/Connectors/api",
					),
					skillsBaseUrl: getEnvOrDefault("AI_HYDRO_SKILLS_BASE_URL_STAGING", "https://ai-hydro.github.io/Skills/api"),
					firebase: {
						apiKey: getEnvOrDefault("AI_HYDRO_FIREBASE_API_KEY_STAGING", ""),
						authDomain: getEnvOrDefault("AI_HYDRO_FIREBASE_AUTH_DOMAIN_STAGING", ""),
						projectId: getEnvOrDefault("AI_HYDRO_FIREBASE_PROJECT_ID_STAGING", ""),
						storageBucket: getEnvOrDefault("AI_HYDRO_FIREBASE_STORAGE_BUCKET_STAGING", ""),
						messagingSenderId: getEnvOrDefault("AI_HYDRO_FIREBASE_MESSAGING_SENDER_ID_STAGING", ""),
						appId: getEnvOrDefault("AI_HYDRO_FIREBASE_APP_ID_STAGING", ""),
					},
				}
			case Environment.local:
				return {
					environment: Environment.local,
					appBaseUrl: getEnvOrDefault("AI_HYDRO_APP_BASE_URL_LOCAL", "http://localhost:3000"),
					apiBaseUrl: getEnvOrDefault("AI_HYDRO_API_BASE_URL_LOCAL", "http://localhost:7777"),
					mcpBaseUrl: getEnvOrDefault("AI_HYDRO_MCP_BASE_URL_LOCAL", "https://ai-hydro.github.io/Marketplace/api"),
					modulesBaseUrl: getEnvOrDefault("AI_HYDRO_MODULES_BASE_URL_LOCAL", "https://ai-hydro.github.io/Modules/api"),
					connectorsBaseUrl: getEnvOrDefault(
						"AI_HYDRO_CONNECTORS_BASE_URL_LOCAL",
						"https://ai-hydro.github.io/Connectors/api",
					),
					skillsBaseUrl: getEnvOrDefault("AI_HYDRO_SKILLS_BASE_URL_LOCAL", "https://ai-hydro.github.io/Skills/api"),
					firebase: {
						apiKey: getEnvOrDefault("AI_HYDRO_FIREBASE_API_KEY_LOCAL", ""),
						authDomain: getEnvOrDefault("AI_HYDRO_FIREBASE_AUTH_DOMAIN_LOCAL", ""),
						projectId: getEnvOrDefault("AI_HYDRO_FIREBASE_PROJECT_ID_LOCAL", ""),
					},
				}
			default:
				return {
					environment: Environment.production,
					appBaseUrl: getEnvOrDefault("AI_HYDRO_APP_BASE_URL", "https://github.com/AI-Hydro/AI-Hydro"),
					apiBaseUrl: getEnvOrDefault("AI_HYDRO_API_BASE_URL", "http://127.0.0.1:7777"),
					mcpBaseUrl: getEnvOrDefault("AI_HYDRO_MCP_BASE_URL", "https://ai-hydro.github.io/Marketplace/api"),
					modulesBaseUrl: getEnvOrDefault("AI_HYDRO_MODULES_BASE_URL", "https://ai-hydro.github.io/Modules/api"),
					connectorsBaseUrl: getEnvOrDefault(
						"AI_HYDRO_CONNECTORS_BASE_URL",
						"https://ai-hydro.github.io/Connectors/api",
					),
					skillsBaseUrl: getEnvOrDefault("AI_HYDRO_SKILLS_BASE_URL", "https://ai-hydro.github.io/Skills/api"),
					firebase: {
						apiKey: getEnvOrDefault("AI_HYDRO_FIREBASE_API_KEY", ""),
						authDomain: getEnvOrDefault("AI_HYDRO_FIREBASE_AUTH_DOMAIN", ""),
						projectId: getEnvOrDefault("AI_HYDRO_FIREBASE_PROJECT_ID", ""),
						storageBucket: getEnvOrDefault("AI_HYDRO_FIREBASE_STORAGE_BUCKET", ""),
						messagingSenderId: getEnvOrDefault("AI_HYDRO_FIREBASE_MESSAGING_SENDER_ID", ""),
						appId: getEnvOrDefault("AI_HYDRO_FIREBASE_APP_ID", ""),
					},
				}
		}
	}
}

/**
 * Singleton instance to access the current environment configuration.
 * Usage:
 * - AiHydroEnv.config() to get the current config.
 * - AiHydroEnv.setEnvironment(Environment.local) to change the environment.
 */
export const AiHydroEnv = AiHydroEndpoint.instance

/**
 * Cloud account/remote-config integrations are opt-in for AI-Hydro.
 * Default is disabled to keep BYO-provider mode fully self-sufficient.
 */
export function isAiHydroCloudAccountEnabled(): boolean {
	return process?.env?.AI_HYDRO_ENABLE_CLOUD_ACCOUNT === "true"
}
