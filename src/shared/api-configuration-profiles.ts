import type { ApiConfiguration, ApiProvider } from "./api"

export interface ApiConfigurationProfile {
	id: string
	name: string
	apiProvider?: ApiProvider
	createdAt: number
	updatedAt: number
}

export interface StoredApiConfigurationProfile extends ApiConfigurationProfile {
	apiConfiguration: ApiConfiguration
}

export interface ApiConfigurationProfilesState {
	activeProfileId?: string
	profiles: StoredApiConfigurationProfile[]
}

export const API_CONFIGURATION_PROFILES_SECRET_KEY = "apiConfigurationProfiles"
