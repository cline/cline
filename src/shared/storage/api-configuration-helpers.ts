import { ApiConfiguration } from "@shared/api"
import { Logger } from "@/services/logging/Logger"
import { ApiHandlerSecrets, ApiHandlerSecretsKeys, SecretKeys, Settings, SettingsKeys } from "./state-keys"

// Helper functions to automatically categorize ApiConfiguration keys based on optimized state definitions
// This ensures we only need to maintain keys in one place (state-keys.ts)

/**
 * Convert SecretKeys array to Set for faster lookup
 */
const SECRET_KEYS = new Set(SecretKeys)

/**
 * Categorizes ApiConfiguration keys into settings and secrets based on optimized state definitions
 */
export function categorizeApiConfigurationKeys(apiConfiguration: Partial<ApiConfiguration>): {
	settingsUpdates: Partial<Settings>
	secretsUpdates: Partial<ApiHandlerSecrets>
} {
	const settingsUpdates: Partial<Settings> = {}
	const secretsUpdates: Partial<ApiHandlerSecrets> = {}

	// Iterate through all keys in the ApiConfiguration
	for (const [key, value] of Object.entries(apiConfiguration)) {
		if (value === undefined) {
			continue // Skip undefined values
		}

		if (SECRET_KEYS.has(key as any)) {
			// This is a secret key
			secretsUpdates[key as keyof ApiHandlerSecrets] = value as any
		} else if (SettingsKeys.has(key)) {
			// This is a settings key
			settingsUpdates[key as keyof Settings] = value as any
		} else {
			// If key is neither in secrets nor settings, it's ignored (shouldn't happen with proper typing)
			Logger.error(`[categorizeApiConfigurationKeys] Uncategorized key: ${key}`)
		}
	}

	return { settingsUpdates, secretsUpdates }
}

/**
 * Type-safe helper to get all API configuration keys that should be stored as settings
 */
export function getApiConfigurationSettingsKeys(): (keyof Settings)[] {
	return Array.from(SettingsKeys) as (keyof Settings)[]
}

/**
 * Type-safe helper to get all API configuration keys that should be stored as secrets
 */
export function getApiConfigurationSecretKeys(): (keyof ApiHandlerSecrets)[] {
	return [...ApiHandlerSecretsKeys]
}
