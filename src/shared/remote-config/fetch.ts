import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { clineEnvConfig } from "@/config"
import { readRemoteConfigFromCache, writeRemoteConfigToCache } from "@/core/storage/disk"
import { AuthService } from "@/services/auth/AuthService"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import { RemoteConfig, RemoteConfigSchema } from "./schema"

/**
 * Fetches remote configuration for the active organization from the API.
 * Falls back to cached config if the request fails.
 *
 * @returns Promise resolving to the RemoteConfig object
 * @throws Error if no active organization exists or if both API fetch and cache retrieval fail
 */
export async function fetchRemoteConfig(): Promise<RemoteConfig> {
	const authService = AuthService.getInstance()

	// Get the active organization ID
	const organizationId = authService.getActiveOrganizationId()
	if (!organizationId) {
		throw new Error("No active organization found")
	}

	try {
		// Get authentication token
		const authToken = await authService.getAuthToken()
		if (!authToken) {
			throw new Error("No Cline account auth token found")
		}

		// Construct URL by replacing {id} placeholder with organizationId
		const endpoint = CLINE_API_ENDPOINT.REMOTE_CONFIG.replace("{id}", organizationId)
		const url = new URL(endpoint, clineEnvConfig.apiBaseUrl).toString()

		// Make authenticated request
		const requestConfig: AxiosRequestConfig = {
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
		}

		const response: AxiosResponse<{ data?: RemoteConfig; error: string; success: boolean }> = await axios.request({
			url,
			method: "GET",
			...requestConfig,
		})

		// Validate response status
		const status = response.status
		if (status < 200 || status >= 300) {
			throw new Error(`Request to ${endpoint} failed with status ${status}`)
		}

		// Validate response structure
		if (response.statusText !== "No Content" && (!response.data || !response.data.data)) {
			throw new Error(`Invalid response from ${endpoint} API`)
		}

		if (typeof response.data === "object" && !response.data.success) {
			throw new Error(`API error: ${response.data.error}`)
		}

		// Extract and validate the config data
		const configData = response.data.data
		if (!configData) {
			throw new Error(`No config data returned from ${endpoint}`)
		}

		// Validate against schema
		const validatedConfig = RemoteConfigSchema.parse(configData)

		// Write to cache
		await writeRemoteConfigToCache(organizationId, validatedConfig)

		return validatedConfig
	} catch (error) {
		console.error("Failed to fetch remote config from API:", error)

		// Try to fall back to cached config
		const cachedConfig = await readRemoteConfigFromCache(organizationId)
		if (cachedConfig) {
			// Validate cached config against schema
			return RemoteConfigSchema.parse(cachedConfig)
		}

		// Both API and cache failed
		throw new Error(
			`Failed to fetch remote config: ${error instanceof Error ? error.message : "Unknown error"}. No cached config available.`,
		)
	}
}
