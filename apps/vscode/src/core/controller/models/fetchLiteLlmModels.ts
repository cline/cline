import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

/**
 * Shape of the LiteLLM `/v1/model/info` response.
 */
export interface LiteLlmModelInfoResponse {
	data: Array<{
		model_name: string
		litellm_params: {
			model: string
			[key: string]: any
		}
		model_info: {
			input_cost_per_token: number
			output_cost_per_token: number
			cache_creation_input_token_cost?: number
			cache_read_input_token_cost?: number
			supports_prompt_caching?: boolean
			[key: string]: any
		}
	}>
}

/**
 * Fetch LiteLLM model info from a LiteLLM proxy.
 *
 * @param baseUrl The base URL for the LiteLLM API
 * @param apiKey The API key for authentication
 * @returns The model info response or undefined if fetch fails
 */
export async function fetchLiteLlmModelsInfo(baseUrl: string, apiKey: string): Promise<LiteLlmModelInfoResponse | undefined> {
	// Handle base URLs that already include /v1 to avoid double /v1/v1/
	const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`
	const url = `${normalizedBaseUrl}/model/info`

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				"x-litellm-api-key": apiKey,
				...buildExternalBasicHeaders(),
			},
		})

		if (response.ok) {
			const data: LiteLlmModelInfoResponse = await response.json()
			return data
		}
		Logger.error("Failed to fetch LiteLLM model info:", response.statusText)
		// Try with Authorization header instead
		const retryResponse = await fetch(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
				...buildExternalBasicHeaders(),
			},
		})

		if (retryResponse.ok) {
			const data: LiteLlmModelInfoResponse = await retryResponse.json()
			return data
		}
		Logger.error("Failed to fetch LiteLLM model info with Authorization header:", retryResponse.statusText)
		throw new Error(`Failed to fetch LiteLLM model info: ${retryResponse.statusText}`)
	} catch (error) {
		Logger.error("Error fetching LiteLLM model info:", error)
		throw error
	}
}
