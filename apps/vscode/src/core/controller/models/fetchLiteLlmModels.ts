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

function buildModelInfoUrls(baseUrl: string): string[] {
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
	const baseUrlWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "")
	const urls = normalizedBaseUrl.endsWith("/v1")
		? [`${normalizedBaseUrl}/model/info`, `${baseUrlWithoutV1}/model/info`]
		: [`${normalizedBaseUrl}/v1/model/info`, `${normalizedBaseUrl}/model/info`]

	return [...new Set(urls)]
}

function modelInfoPath(url: string): string {
	try {
		return new URL(url).pathname
	} catch {
		return url
	}
}

async function describeHttpFailure(response: Response): Promise<string> {
	const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim()
	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const details = body ? `${response.status}${statusText}: ${body.slice(0, 500)}` : `${response.status}${statusText}`
	return body.length > 500 ? `${details}...` : details
}

/**
 * Fetch LiteLLM model info from a LiteLLM proxy.
 *
 * @param baseUrl The base URL for the LiteLLM API
 * @param apiKey The API key for authentication
 * @returns The model info response
 * @throws {Error} When all endpoint/auth-header combinations fail
 */
export async function fetchLiteLlmModelsInfo(baseUrl: string, apiKey: string): Promise<LiteLlmModelInfoResponse> {
	const failures: string[] = []
	const authHeaders = [
		["x-litellm-api-key", { "x-litellm-api-key": apiKey }],
		["Authorization", { Authorization: `Bearer ${apiKey}` }],
	] as const

	for (const url of buildModelInfoUrls(baseUrl)) {
		for (const [authLabel, authHeader] of authHeaders) {
			try {
				const response = await fetch(url, {
					method: "GET",
					headers: {
						accept: "application/json",
						...authHeader,
						...buildExternalBasicHeaders(),
					},
				})

				if (response.ok) {
					const data: LiteLlmModelInfoResponse = await response.json()
					return data
				}
				failures.push(`${modelInfoPath(url)} (${authLabel}): ${await describeHttpFailure(response)}`)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				failures.push(`${modelInfoPath(url)} (${authLabel}): ${message}`)
			}
		}
	}

	const message = `Failed to fetch LiteLLM model info. Attempts: ${failures.join("; ")}`
	Logger.error(message)
	throw new Error(message)
}
