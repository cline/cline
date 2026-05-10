import type { ApiConfiguration, ApiProvider } from "./api"

export const MAX_API_CONFIGURATION_PROFILES = 20

export interface ApiConfigurationProfile {
	id: string
	name: string
	apiProvider?: ApiProvider
	createdAt: number
	updatedAt: number
}

export interface StoredApiConfigurationProfile extends ApiConfigurationProfile {
	apiConfigurationSecretKey?: string
	/** @deprecated Legacy profile payload stored inline before profiles were split across per-profile secrets. */
	apiConfiguration?: ApiConfiguration
}

export interface ApiConfigurationProfilesState {
	activeProfileId?: string
	profiles: StoredApiConfigurationProfile[]
}

export const API_CONFIGURATION_PROFILES_STATE_KEY = "apiConfigurationProfiles"
export const LEGACY_API_CONFIGURATION_PROFILES_SECRET_KEY = "apiConfigurationProfiles"
export const getApiConfigurationProfileSecretKey = (profileId: string) => `apiConfigurationProfile.${profileId}`
