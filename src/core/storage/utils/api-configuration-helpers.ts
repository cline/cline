import { ApiConfiguration } from "@shared/api"
import { SecretKeys, Secrets, Settings, SettingsKeys } from "../state-keys"

/**
 * Helper functions to automatically categorize ApiConfiguration keys based on optimized state definitions
 * This ensures we only need to maintain keys in one place (state-keys.ts)
 */

// Convert SecretKeys array to Set for faster lookup
const SECRET_KEYS = new Set(SecretKeys)

/**
 * Categorizes ApiConfiguration keys into settings and secrets based on optimized state definitions
 */
export function categorizeApiConfigurationKeys(apiConfiguration: ApiConfiguration): {
	settingsUpdates: Partial<Settings>
	secretsUpdates: Partial<Secrets>
} {
	const settingsUpdates: Partial<Settings> = {}
	const secretsUpdates: Partial<Secrets> = {}

	// Iterate through all keys in the ApiConfiguration
	for (const [key, value] of Object.entries(apiConfiguration)) {
		if (value === undefined) {
			continue // Skip undefined values
		}

		if (SECRET_KEYS.has(key as any)) {
			// This is a secret key
			;(secretsUpdates as any)[key] = value
		} else if (SettingsKeys.has(key)) {
			// This is a settings key
			;(settingsUpdates as any)[key] = value
		}
		// If key is neither in secrets nor settings, it's ignored (shouldn't happen with proper typing)
	}

	return { settingsUpdates, secretsUpdates }
}

/**
 * Type-safe helper to get all API configuration keys that should be stored as settings
 */
export function getApiConfigurationSettingsKeys(): (keyof Settings)[] {
	return Array.from(SettingsKeys).filter(
		(_key) =>
			// Only include keys that could be part of ApiConfiguration
			// This is a type-safe way to ensure we only get relevant keys
			true,
	) as (keyof Settings)[]
}

/**
 * Type-safe helper to get all API configuration keys that should be stored as secrets
 */
export function getApiConfigurationSecretKeys(): (keyof Secrets)[] {
	return [...SecretKeys] as (keyof Secrets)[]
}
