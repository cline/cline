/**
 * Inert shell: the LiteLLM model-info fetcher has been removed.
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

export async function fetchLiteLlmModelsInfo(_baseUrl: string, _apiKey: string): Promise<LiteLlmModelInfoResponse | undefined> {
	return undefined
}
