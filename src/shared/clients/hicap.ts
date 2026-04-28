export const HICAP_ENDPOINTS = ["v1", "v2-openai-dev"] as const
export type HicapApiEndpoint = (typeof HICAP_ENDPOINTS)[number]

export const DEFAULT_HICAP_API_ENDPOINT: HicapApiEndpoint = "v1"

export const HICAP_ENDPOINT_LABELS: Record<HicapApiEndpoint, string> = {
	v1: "Prod",
	"v2-openai-dev": "Dev",
}

export const HICAP_ENDPOINT_BASE_URLS: Record<HicapApiEndpoint, string> = {
	v1: "https://api.hicap.ai/v1",
	"v2-openai-dev": "https://api.hicap.ai/v2/openai/dev",
}

export function normalizeHicapApiEndpoint(endpoint?: string): HicapApiEndpoint {
	return HICAP_ENDPOINTS.includes(endpoint as HicapApiEndpoint) ? (endpoint as HicapApiEndpoint) : DEFAULT_HICAP_API_ENDPOINT
}

export function getHicapBaseUrl(endpoint?: string): string {
	return HICAP_ENDPOINT_BASE_URLS[normalizeHicapApiEndpoint(endpoint)]
}

export function getHicapModelsUrl(endpoint?: string): string {
	return `${getHicapBaseUrl(endpoint)}/models`
}

export function getNextHicapApiEndpoint(endpoint?: string): HicapApiEndpoint {
	const current = normalizeHicapApiEndpoint(endpoint)
	const currentIndex = HICAP_ENDPOINTS.indexOf(current)
	return HICAP_ENDPOINTS[(currentIndex + 1) % HICAP_ENDPOINTS.length]
}

export function supportsHicapResponsesApi(modelId?: string): boolean {
	return modelId?.trim().toLowerCase().startsWith("gpt") ?? false
}
