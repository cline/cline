export const HICAP_BASE_URL = "https://api.hicap.ai/v1"
export const HICAP_TAG_HEADER = "x-hicap-tag"
export const HICAP_TAG_VALUE = "cline"

export function getHicapBaseUrl(): string {
	return HICAP_BASE_URL
}

export function getHicapModelsUrl(): string {
	return `${getHicapBaseUrl()}/models`
}

export function supportsHicapResponsesApi(modelId?: string): boolean {
	return modelId?.trim().toLowerCase().startsWith("gpt") ?? false
}
