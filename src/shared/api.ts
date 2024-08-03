export type ApiProvider = "anthropic" | "openrouter" | "bedrock"

export interface ApiHandlerOptions {
	apiKey?: string // anthropic
	openRouterApiKey?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsRegion?: string
}

export type ApiConfiguration = ApiHandlerOptions & {
	apiProvider?: ApiProvider
}
