import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { Controller } from "@/core/controller"
import { getAxiosSettings } from "@/shared/net"
import { ClineEnv } from "../../../config"
import { AuthService } from "../../../services/auth/AuthService"
import { CLINE_API_ENDPOINT } from "../../../shared/cline/api"
import { APIKeySchema, type APIKeySettings, RemoteConfig, RemoteConfigSchema } from "../../../shared/remote-config/schema"
import { deleteRemoteConfigFromCache, readRemoteConfigFromCache, writeRemoteConfigToCache } from "../disk"
import { StateManager } from "../StateManager"
import { applyRemoteConfig } from "./utils"

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
		console.error(`Failed to parse providers api keys`, err)
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
 * Fetches remote configuration for a specific organization from the API.
 * Falls back to cached config if the request fails.
 *
 * @param organizationId The organization ID to fetch config for
 * @returns RemoteConfig if enabled, undefined if disabled or not found
 */
async function fetchRemoteConfigForOrganization(organizationId: string): Promise<RemoteConfig | undefined> {
	try {
		// Fetch config data using helper
		const configData = await makeAuthenticatedRequest<{ value: string; enabled: boolean }>(
			CLINE_API_ENDPOINT.REMOTE_CONFIG,
			organizationId,
		)

		// Check if config is enabled
		if (!configData.enabled) {
			// Clear the remote config from the on-disk cache if it exists
			await deleteRemoteConfigFromCache(organizationId)
			return undefined
		}

		// Parse the JSON-encoded Value field
		const parsedConfig = JSON.parse(configData.value)

		// Validate against schema
		const validatedConfig = RemoteConfigSchema.parse(parsedConfig)

		return validatedConfig
	} catch (error) {
		console.error(`Failed to fetch remote config for organization ${organizationId}:`, error)

		// Try to fall back to cached config
		const cachedConfig = await readRemoteConfigFromCache(organizationId)
		if (cachedConfig) {
			try {
				// Validate cached config against schema
				const validatedCachedConfig = RemoteConfigSchema.parse(cachedConfig)
				return validatedCachedConfig
			} catch (validationError) {
				// Cache validation failed - log and continue
				console.error(`Cached config validation failed for organization ${organizationId}:`, validationError)
			}
		}

		return undefined
	}
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
		console.error(`Failed to fetch API keys for organization ${organizationId}:`, error)
		return {}
	}
}

/**
 * Scans all user organizations to find the first one with an enabled remote configuration.
 *
 * @returns Object containing the organization ID and config, or undefined if none found
 */
async function findOrganizationWithRemoteConfig(): Promise<{ organizationId: string; config: RemoteConfig } | undefined> {
	const authService = AuthService.getInstance()

	// Get all user organizations from cached auth info
	const userOrganizations = authService.getUserOrganizations()

	if (!userOrganizations || userOrganizations.length === 0) {
		return undefined
	}

	// Scan each organization for remote config
	for (const org of userOrganizations) {
		const remoteConfig = await fetchRemoteConfigForOrganization(org.organizationId)

		if (remoteConfig) {
			return {
				organizationId: org.organizationId,
				config: remoteConfig,
			}
		}
	}

	return undefined
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
			StateManager.get().clearRemoteConfig()
			controller.postStateToWebview()
			return undefined
		}

		const { organizationId, config } = result

		// Check if we need to switch organizations
		const currentActiveOrgId = authService.getActiveOrganizationId()
		if (currentActiveOrgId !== organizationId) {
			await controller.accountService.switchAccount(organizationId)
		}

		// Fetch and store API keys for configured providers
		const hasConfiguredProviders = config.providerSettings && Object.keys(config.providerSettings).length > 0
		if (hasConfiguredProviders) {
			const apiKeys = await fetchApiKeysForOrganization(organizationId)
			if (config.providerSettings?.LiteLLM) {
				if (apiKeys.litellm) {
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
		await applyRemoteConfig(config)
		controller.postStateToWebview()

		return config
	} catch (error) {
		console.error("Failed to ensure user in organization with remote config:", error)
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
		console.error("Failed to fetch remote config", error)
	}
}
