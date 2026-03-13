import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { Controller } from "@/core/controller"
import { buildBasicClineHeaders } from "@/services/EnvUtils"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { ConfiguredAPIKeys } from "@/shared/storage/state-keys"
import { ClineEnv } from "../../../config"
import { AuthService } from "../../../services/auth/AuthService"
import { CLINE_API_ENDPOINT } from "../../../shared/cline/api"
import { APIKeySchema, type APIKeySettings, RemoteConfig, RemoteConfigSchema } from "../../../shared/remote-config/schema"
import { deleteRemoteConfigFromCache, readRemoteConfigFromCache, writeRemoteConfigToCache } from "../disk"
import { applyRemoteConfig, clearRemoteConfig, isRemoteConfigEnabled } from "./utils"

/**
 * Parses API keys from a JSON string response
 * @param value The JSON string containing API keys
 * @returns Parsed API key settings object
 */
function parseApiKeys(value: string): APIKeySettings {
	try {
		if (!value) {
			return {}
		}
		return APIKeySchema.parse(JSON.parse(value))
	} catch (err) {
		Logger.error(`Failed to parse providers api keys`, err)
		return {}
	}
}

/**
 * Helper function to make authenticated requests to the Cline API
 * @param endpoint The API endpoint path (with {id} placeholder if needed)
 * @param organizationId The organization ID to replace in the endpoint
 * @returns The response data on success
 * @throws Error if the request fails or returns an error
 */
async function makeAuthenticatedRequest<T>(endpoint: string, organizationId: string): Promise<T> {
	const authService = AuthService.getInstance()

	// Get authentication token
	const authToken = await authService.getAuthToken()
	if (!authToken) {
		throw new Error("No Cline account auth token found")
	}

	// Construct URL by replacing {id} placeholder with organizationId
	const apiEndpoint = endpoint.replace("{id}", organizationId)
	const url = new URL(apiEndpoint, ClineEnv.config().apiBaseUrl).toString()

	// Make authenticated request
	const requestConfig: AxiosRequestConfig = {
		headers: {
			Authorization: `Bearer ${authToken}`,
			"Content-Type": "application/json",
			...(await buildBasicClineHeaders()),
		},
		...getAxiosSettings(),
	}

	const response: AxiosResponse<{
		data?: T
		error: string
		success: boolean
	}> = await axios.request({
		url,
		method: "GET",
		...requestConfig,
	})

	// Validate response status
	const status = response.status
	if (status < 200 || status >= 300) {
		throw new Error(`Request to ${apiEndpoint} failed with status ${status}`)
	}

	// Validate response structure
	if (!response.data || !response.data.success) {
		throw new Error(`API error: ${response.data?.error || "Unknown error"}`)
	}

	// Extract and return data
	const data = response.data.data
	if (!data) {
		throw new Error(`No data returned from ${apiEndpoint}`)
	}

	return data
}

/**
 * Fetches API keys for a specific organization from the API.
 *
 * @param organizationId The organization ID to fetch API keys for
 * @returns Record of API keys (e.g., { litellm: "key" }) or undefined if fetch fails
 */
async function fetchApiKeysForOrganization(organizationId: string): Promise<APIKeySettings> {
	try {
		// Fetch API keys string using helper
		const response = await makeAuthenticatedRequest<{ providerApiKeys: string }>(CLINE_API_ENDPOINT.API_KEYS, organizationId)

		// Parse and return API keys
		return parseApiKeys(response?.providerApiKeys)
	} catch (error) {
		Logger.error(`Failed to fetch API keys for organization ${organizationId}:`, error)
		return {}
	}
}

/**
 * Finds the user's organization with remote config enabled.
 * Uses the user-level endpoint which always returns the latest state from the server,
 * including newly created organizations. Falls back to disk cache on failure.
 *
 * @returns Object containing the organization ID and config, or undefined if none found
 */
async function findOrganizationWithRemoteConfig(): Promise<{ organizationId: string; config: RemoteConfig } | undefined> {
	try {
		const result = await fetchUserRemoteConfig()

		if (!result) {
			return undefined
		}

		// Respect user opt-out of remote config
		if (!isRemoteConfigEnabled(result.organizationId)) {
			return undefined
		}

		return result
	} catch (error) {
		Logger.error("Failed to fetch user remote config, trying cache fallback:", error)

		// Fall back to disk cache using the currently active org
		const authService = AuthService.getInstance()
		const activeOrgId = authService.getActiveOrganizationId()
		if (activeOrgId) {
			const cachedConfig = await readRemoteConfigFromCache(activeOrgId)
			if (cachedConfig) {
				try {
					const validatedCachedConfig = RemoteConfigSchema.parse(cachedConfig)
					if (isRemoteConfigEnabled(activeOrgId)) {
						return { organizationId: activeOrgId, config: validatedCachedConfig }
					}
				} catch (validationError) {
					Logger.error(`Cached config validation failed for organization ${activeOrgId}:`, validationError)
				}
			}
		}

		return undefined
	}
}

/**
 * Fetches remote configuration across all user organizations using the user-level endpoint.
 * Unlike the per-org endpoint, this does not depend on the cached organization list,
 * so it immediately discovers newly created organizations with remote config.
 *
 * @returns Object containing the organization ID and config, or undefined if none found
 */
async function fetchUserRemoteConfig(): Promise<{ organizationId: string; config: RemoteConfig } | undefined> {
	const authService = AuthService.getInstance()

	const authToken = await authService.getAuthToken()
	if (!authToken) {
		return undefined
	}

	const url = new URL(CLINE_API_ENDPOINT.USER_REMOTE_CONFIG, ClineEnv.config().apiBaseUrl).toString()

	const requestConfig: AxiosRequestConfig = {
		headers: {
			Authorization: `Bearer ${authToken}`,
			"Content-Type": "application/json",
			...(await buildBasicClineHeaders()),
		},
		...getAxiosSettings(),
	}

	const response: AxiosResponse<{
		data?: { organizationId: string; value: string; enabled: boolean }
		error?: string
		success: boolean
	}> = await axios.request({
		url,
		method: "GET",
		...requestConfig,
	})

	const status = response.status
	if (status < 200 || status >= 300) {
		throw new Error(`Request to ${CLINE_API_ENDPOINT.USER_REMOTE_CONFIG} failed with status ${status}`)
	}

	if (!response.data?.success || !response.data?.data) {
		return undefined
	}

	const { organizationId, value, enabled } = response.data.data

	if (!enabled || !value || !organizationId) {
		// Config exists but is disabled — clear any stale cache
		if (organizationId) {
			await deleteRemoteConfigFromCache(organizationId)
		}
		return undefined
	}

	const parsedConfig = JSON.parse(value)
	const validatedConfig = RemoteConfigSchema.parse(parsedConfig)

	return { organizationId, config: validatedConfig }
}

/**
 * Ensures the user is in the correct organization with remote configuration enabled.
 * Automatically switches to the organization if needed and applies the remote config.
 *
 * @param controller The controller instance
 * @returns RemoteConfig if found and applied, undefined otherwise
 */
async function ensureUserInOrgWithRemoteConfig(controller: Controller): Promise<RemoteConfig | undefined> {
	const authService = AuthService.getInstance()

	try {
		// Find an organization with remote config
		const result = await findOrganizationWithRemoteConfig()

		if (!result) {
			clearRemoteConfig()
			controller.postStateToWebview()
			return undefined
		}

		const { organizationId, config } = result

		// Check if we need to switch organizations
		const currentActiveOrgId = authService.getActiveOrganizationId()
		if (currentActiveOrgId !== organizationId) {
			await controller.accountService.switchAccount(organizationId)
		}

		const configuredApiKeys: ConfiguredAPIKeys = {}
		// Fetch and store API keys for configured providers
		const hasConfiguredProviders = config.providerSettings && Object.keys(config.providerSettings).length > 0
		if (hasConfiguredProviders) {
			const apiKeys = await fetchApiKeysForOrganization(organizationId)
			if (config.providerSettings?.LiteLLM) {
				if (apiKeys.litellm) {
					configuredApiKeys["litellm"] = true
					controller.stateManager.setSecret("remoteLiteLlmApiKey", apiKeys.litellm)
				} else {
					controller.stateManager.setSecret("remoteLiteLlmApiKey", undefined)
				}
			} else {
				controller.stateManager.setSecret("remoteLiteLlmApiKey", undefined)
			}
		} else {
			controller.stateManager.setSecret("remoteLiteLlmApiKey", undefined)
		}

		// Cache and apply the remote config
		await writeRemoteConfigToCache(organizationId, config)
		if (isRemoteConfigEnabled(organizationId)) {
			await applyRemoteConfig(config, configuredApiKeys, controller.mcpHub)
		} else {
			clearRemoteConfig()
		}
		controller.postStateToWebview()

		return config
	} catch (error) {
		Logger.error("Failed to ensure user in organization with remote config:", error)
		return undefined
	}
}

/**
 * Main entry point for fetching remote configuration.
 * Scans all user organizations, switches to the one with remote config if found,
 * and applies the configuration.
 *
 * It catches any exceptions, logs them and does not propagate them to the caller.
 *
 * This function is called periodically to ensure users stay in
 * organizations with remote configuration enabled.
 *
 * @param controller The controller instance
 */
export async function fetchRemoteConfig(controller: Controller) {
	try {
		await ensureUserInOrgWithRemoteConfig(controller)
	} catch (error) {
		Logger.error("Failed to fetch remote config", error)
	}
}
