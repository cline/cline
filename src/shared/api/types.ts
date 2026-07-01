export interface ApiHandlerOptions {
	apiKey?: string
	apiModelId?: string
	apiBaseUrl?: string
	organizationId?: string
	profileName?: string
	stream?: boolean
}

export const DEFAULT_STREAMING_ENABLED = true
