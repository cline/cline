import { ApiConfiguration } from "@shared/api"
import { isSecretKey, isSettingsKey, SecretKeys, Secrets, Settings, SettingsKeys } from "./state-keys"

// Helper functions to automatically categorize ApiConfiguration keys based on optimized state definitions
// This ensures we only need to maintain keys in one place (state-keys.ts)

/**
 * Categorizes ApiConfiguration keys into settings and secrets based on optimized state definitions
 */
export function categorizeApiConfigurationKeys(apiConfiguration: ApiConfiguration): {
	settingsUpdates: Partial<Settings>
	secretsUpdates: Partial<Secrets>
} {
	return Object.entries(apiConfiguration).reduce(
		(acc, [key, value]) => {
			if (key === undefined || value === undefined) {
				return acc // Skip undefined values
			}

			if (isSecretKey(key)) {
				// This is a secret key
				acc.secretsUpdates[key as keyof Secrets] = value as any
			} else if (isSettingsKey(key)) {
				// This is a settings key
				acc.settingsUpdates[key as keyof Settings] = value as any
			}

			return acc
		},
		{ settingsUpdates: {} as Partial<Settings>, secretsUpdates: {} as Partial<Secrets> },
	)
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
export function getApiConfigurationSecretKeys(): (keyof Secrets)[] {
	return SecretKeys
}
