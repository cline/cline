export interface LaminarClientConfig {
	/**
	 * The API key for Laminar telemetry service.
	 * Only enable Laminar when this is set via LMNR_PROJECT_API_KEY environment variable.
	 */
	apiKey?: string | undefined
	recordIO: boolean
}

export interface LaminarClientValidConfig extends LaminarClientConfig {
	apiKey: string
}

const isTestEnv = process.env.E2E_TEST === "true" || process.env.IS_TEST === "true"

export const laminarConfig: LaminarClientConfig = {
	apiKey: process.env.LMNR_PROJECT_API_KEY,
	recordIO: process.env.LMNR_RECORD_IO === "true",
}

export function isLaminarConfigValid(config: LaminarClientConfig): config is LaminarClientValidConfig {
	if (isTestEnv) {
		return false
	}

	return typeof config.apiKey === "string" && config.apiKey.length > 0
}
