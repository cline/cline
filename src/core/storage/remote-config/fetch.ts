import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { Controller } from "@/core/controller"
import { ClineEnv } from "../../../config"
import { AuthService } from "../../../services/auth/AuthService"
import { CLINE_API_ENDPOINT } from "../../../shared/cline/api"
import { RemoteConfig, RemoteConfigSchema } from "../../../shared/remote-config/schema"
import { deleteRemoteConfigFromCache, readRemoteConfigFromCache, writeRemoteConfigToCache } from "../disk"
import { StateManager } from "../StateManager"
import { applyRemoteConfig } from "./utils"

/**
 * Fetches remote configuration for a specific organization from the API.
 * Falls back to cached config if the request fails.
 *
 * @param organizationId The organization ID to fetch config for
 * @returns RemoteConfig if enabled, undefined if disabled or not found
 */
async function fetchRemoteConfigForOrganization(organizationId: string): Promise<RemoteConfig | undefined> {
	const authService = AuthService.getInstance()

	try {
		// Get authentication token
		const authToken = await authService.getAuthToken()
		if (!authToken) {
			throw new Error("No Cline account auth token found")
		}

		// Construct URL by replacing {id} placeholder with organizationId
		const endpoint = CLINE_API_ENDPOINT.REMOTE_CONFIG.replace("{id}", organizationId)
		const url = new URL(endpoint, ClineEnv.config().apiBaseUrl).toString()

		// Make authenticated request
		const requestConfig: AxiosRequestConfig = {
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
			},
		}

		const response: AxiosResponse<{
			data?: { value: string; enabled: boolean }
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

		// Cache and apply the remote config
		await writeRemoteConfigToCache(organizationId, config)
		applyRemoteConfig(config)
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
