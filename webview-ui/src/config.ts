export type Environment = "production" | "staging" | "local"

// Use the injected global variable from vite.config.ts
declare const __APP_BASE_URL__: string

interface EnvironmentConfig {
	appBaseUrl: string
}

export const clineEnvConfig: EnvironmentConfig = {
	appBaseUrl: typeof __APP_BASE_URL__ !== "undefined" ? __APP_BASE_URL__ : "https://app.cline.bot",
}
