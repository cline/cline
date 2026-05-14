import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"

export interface OAuthCredentials {
	accessToken?: string
	refreshToken?: string
	accountId?: string
}

export interface StartSessionResult {
	sessionId: string
}

export interface SessionHistoryRecord {
	id: string
}

export type CoreSessionEvent = { type: string; payload?: unknown }

interface ProviderSettingsState {
	providers: Record<string, Record<string, unknown>>
	lastUsedProvider?: string
}

export class ProviderSettingsManager {
	private state: ProviderSettingsState = { providers: {} }

	constructor(_options?: { filePath?: string; dataDir?: string }) {}

	read(): ProviderSettingsState {
		return { providers: { ...this.state.providers }, lastUsedProvider: this.state.lastUsedProvider }
	}

	getProviderSettings(providerId: string): Record<string, unknown> | undefined {
		return this.state.providers[providerId]
	}

	getLastUsedProviderSettings(): Record<string, unknown> | undefined {
		return this.state.lastUsedProvider ? this.state.providers[this.state.lastUsedProvider] : undefined
	}

	saveProviderSettings(settings: Record<string, unknown>, options?: { setLastUsed?: boolean }): ProviderSettingsState {
		const provider = settings.provider
		if (typeof provider !== "string") {
			throw new Error("provider is required")
		}
		this.state.providers[provider] = { ...settings }
		if (options?.setLastUsed !== false) {
			this.state.lastUsedProvider = provider
		}
		return this.read()
	}
}

export interface ModelCatalogConfig {
	loadLatestOnInit?: boolean
	loadPrivateOnAuth?: boolean
	failOnError?: boolean
	cacheTtlMs?: number
}

export async function resolveProviderConfig(
	providerId: string,
	_config?: ModelCatalogConfig,
	providerConfig?: { modelId?: string },
) {
	const knownModels = getGeneratedModelsForProvider(providerId)
	const requestedModelId = providerConfig?.modelId?.trim()
	const defaultModelId = MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.provider.defaultModelId
	const modelId = requestedModelId && knownModels[requestedModelId] ? requestedModelId : defaultModelId
	return { modelId, knownModels }
}

export function createOAuthClientCallbacks() {
	return {}
}

export async function getValidClineCredentials(): Promise<OAuthCredentials | undefined> {
	return undefined
}

export async function loginClineOAuth(): Promise<OAuthCredentials> {
	return {}
}

export async function loginOcaOAuth(): Promise<OAuthCredentials> {
	return {}
}

export async function loginOpenAICodex(): Promise<OAuthCredentials> {
	return {}
}
