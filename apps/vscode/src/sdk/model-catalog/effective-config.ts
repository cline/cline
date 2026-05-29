import type { ApiConfiguration } from "@shared/api"
import { StateManager } from "@/core/storage/StateManager"
import { getProviderSettingsManager } from "../provider-migration"
import type { EffectiveProviderConfig, ProviderId } from "./contracts"

type AuthConfig = NonNullable<EffectiveProviderConfig["auth"]>
type ExtrasConfig = NonNullable<EffectiveProviderConfig["extras"]>

type ConfigParts = Omit<EffectiveProviderConfig, "providerId">
type ConfigKey = keyof ConfigParts

type ProviderSettingsLike = {
	readonly apiKey?: string
	readonly baseUrl?: string
	readonly apiLine?: string
	readonly headers?: Readonly<Record<string, string>>
	readonly region?: string
	readonly auth?: AuthConfig
	readonly extras?: ExtrasConfig
}

const apiKeyFields: Partial<Record<string, keyof ApiConfiguration>> = {
	anthropic: "apiKey",
	openrouter: "openRouterApiKey",
	openai: "openAiApiKey",
	"openai-native": "openAiNativeApiKey",
	"openai-codex": "openAiNativeApiKey",
	bedrock: "awsBedrockApiKey",
	gemini: "geminiApiKey",
	deepseek: "deepSeekApiKey",
	ollama: "ollamaApiKey",
	requesty: "requestyApiKey",
	together: "togetherApiKey",
	fireworks: "fireworksApiKey",
	qwen: "qwenApiKey",
	"qwen-code": "qwenApiKey",
	doubao: "doubaoApiKey",
	mistral: "mistralApiKey",
	litellm: "liteLlmApiKey",
	asksage: "asksageApiKey",
	xai: "xaiApiKey",
	moonshot: "moonshotApiKey",
	zai: "zaiApiKey",
	huggingface: "huggingFaceApiKey",
	nebius: "nebiusApiKey",
	sambanova: "sambanovaApiKey",
	cerebras: "cerebrasApiKey",
	groq: "groqApiKey",
	baseten: "basetenApiKey",
	"huawei-cloud-maas": "huaweiCloudMaasApiKey",
	dify: "difyApiKey",
	minimax: "minimaxApiKey",
	hicap: "hicapApiKey",
	aihubmix: "aihubmixApiKey",
	nousresearch: "nousResearchApiKey",
	"vercel-ai-gateway": "vercelAiGatewayApiKey",
	wandb: "wandbApiKey",
	oca: "ocaApiKey",
	cline: "clineApiKey",
}

const baseUrlFields: Partial<Record<string, keyof ApiConfiguration>> = {
	anthropic: "anthropicBaseUrl",
	openai: "openAiBaseUrl",
	ollama: "ollamaBaseUrl",
	lmstudio: "lmStudioBaseUrl",
	gemini: "geminiBaseUrl",
	requesty: "requestyBaseUrl",
	asksage: "asksageApiUrl",
	litellm: "liteLlmBaseUrl",
	sapaicore: "sapAiCoreBaseUrl",
	dify: "difyBaseUrl",
	oca: "ocaBaseUrl",
	aihubmix: "aihubmixBaseUrl",
}

const apiLineFields: Partial<Record<string, keyof ApiConfiguration>> = {
	qwen: "qwenApiLine",
	moonshot: "moonshotApiLine",
	zai: "zaiApiLine",
	minimax: "minimaxApiLine",
}

const regionFields: Partial<Record<string, keyof ApiConfiguration>> = {
	bedrock: "awsRegion",
	vertex: "vertexRegion",
}

const headerFields: Partial<Record<string, keyof ApiConfiguration>> = {
	openai: "openAiHeaders",
}

const extrasFields: Partial<Record<string, Partial<Record<string, keyof ApiConfiguration>>>> = {
	ollama: { ollamaApiOptionsCtxNum: "ollamaApiOptionsCtxNum" },
	lmstudio: { lmStudioMaxTokens: "lmStudioMaxTokens" },
	litellm: { liteLlmUsePromptCache: "liteLlmUsePromptCache" },
	openrouter: { openRouterProviderSorting: "openRouterProviderSorting" },
	bedrock: {
		awsAuthentication: "awsAuthentication",
		awsBedrockEndpoint: "awsBedrockEndpoint",
		awsBedrockUsePromptCache: "awsBedrockUsePromptCache",
		awsProfile: "awsProfile",
		awsUseCrossRegionInference: "awsUseCrossRegionInference",
		awsUseGlobalInference: "awsUseGlobalInference",
		awsUseProfile: "awsUseProfile",
	},
	sapaicore: {
		sapAiCoreTokenUrl: "sapAiCoreTokenUrl",
		sapAiCoreUseOrchestrationMode: "sapAiCoreUseOrchestrationMode",
		sapAiResourceGroup: "sapAiResourceGroup",
	},
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key]
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function readHeaders(record: Record<string, unknown>, key: string): Readonly<Record<string, string>> | undefined {
	const value = record[key]
	if (!isPlainRecord(value)) {
		return undefined
	}

	const headers: Record<string, string> = {}
	for (const [headerName, headerValue] of Object.entries(value)) {
		if (typeof headerValue !== "string") {
			return undefined
		}
		headers[headerName] = headerValue
	}
	return Object.keys(headers).length > 0 ? headers : undefined
}

function readAuth(record: Record<string, unknown>): AuthConfig | undefined {
	const auth = record.auth
	if (!isPlainRecord(auth)) {
		return undefined
	}

	const accessToken = readString(auth, "accessToken")
	const refreshToken = readString(auth, "refreshToken")
	const accountId = readString(auth, "accountId")
	return accessToken || refreshToken || accountId ? { accessToken, refreshToken, accountId } : undefined
}

function readProviderSettings(providerId: ProviderId): ConfigParts {
	try {
		const settings: unknown = getProviderSettingsManager().getProviderSettings(providerId)
		if (!isPlainRecord(settings)) {
			return {}
		}

		return {
			apiKey: readString(settings, "apiKey"),
			baseUrl: readString(settings, "baseUrl"),
			apiLine: readString(settings, "apiLine"),
			headers: readHeaders(settings, "headers"),
			region: readString(settings, "region"),
			auth: readAuth(settings),
			extras: isPlainRecord(settings.extras) ? settings.extras : undefined,
		} satisfies ProviderSettingsLike
	} catch {
		return {}
	}
}

function readStringFromConfig(config: ApiConfiguration, field: keyof ApiConfiguration | undefined): string | undefined {
	if (!field) {
		return undefined
	}
	const value = config[field]
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function readHeadersFromConfig(
	config: ApiConfiguration,
	field: keyof ApiConfiguration | undefined,
): Readonly<Record<string, string>> | undefined {
	if (!field) {
		return undefined
	}
	const value = config[field]
	return isPlainRecord(value) ? readHeaders({ value }, "value") : undefined
}

function readStateExtras(provider: string, config: ApiConfiguration): ExtrasConfig | undefined {
	const fieldMap = extrasFields[provider]
	if (!fieldMap) {
		return undefined
	}

	const extras: Record<string, unknown> = {}
	for (const [extraName, configField] of Object.entries(fieldMap)) {
		if (configField === undefined) {
			continue
		}
		const value = config[configField]
		if (value !== undefined) {
			extras[extraName] = value
		}
	}
	return Object.keys(extras).length > 0 ? extras : undefined
}

function readStateAuth(provider: string, config: ApiConfiguration): AuthConfig | undefined {
	if (provider !== "cline") {
		return undefined
	}

	const accessToken = readStringFromConfig(config, "clineApiKey")
	const accountId = readStringFromConfig(config, "clineAccountId")
	return accessToken || accountId ? { accessToken, accountId } : undefined
}

function readStateConfig(providerId: ProviderId, config: ApiConfiguration): ConfigParts {
	const provider = providerId.toString()
	return {
		apiKey: readStringFromConfig(config, apiKeyFields[provider]),
		baseUrl: readStringFromConfig(config, baseUrlFields[provider]),
		apiLine: readStringFromConfig(config, apiLineFields[provider]),
		headers: readHeadersFromConfig(config, headerFields[provider]),
		region: readStringFromConfig(config, regionFields[provider]),
		auth: readStateAuth(provider, config),
		extras: readStateExtras(provider, config),
	}
}

function mergeExtras(first: ExtrasConfig | undefined, second: ExtrasConfig | undefined): ExtrasConfig | undefined {
	if (!first) {
		return second
	}
	if (!second) {
		return first
	}
	return { ...first, ...second }
}

function assignIfDefined<T extends ConfigKey>(target: Partial<ConfigParts>, key: T, value: ConfigParts[T] | undefined): void {
	if (value !== undefined) {
		target[key] = value
	}
}

/**
 * Build an {@link EffectiveProviderConfig} by merging provider-owned settings
 * from SDK `providers.json` with the current StateManager effective API
 * configuration. StateManager's `getApiConfiguration()` already applies
 * task/session/remote-config overlays for legacy fields, so those values win.
 *
 * Mode-dependent model selection is intentionally excluded; callers use
 * `ProviderConfigStore.readSelection(providerId, mode)` for that in Phase 1.4.
 */
export function buildEffectiveProviderConfig(providerId: ProviderId): EffectiveProviderConfig {
	const providerSettings = readProviderSettings(providerId)
	const stateConfig = readStateConfig(providerId, StateManager.get().getApiConfiguration())
	const merged: Partial<ConfigParts> = {}

	assignIfDefined(merged, "apiKey", stateConfig.apiKey ?? providerSettings.apiKey)
	assignIfDefined(merged, "baseUrl", stateConfig.baseUrl ?? providerSettings.baseUrl)
	assignIfDefined(merged, "apiLine", stateConfig.apiLine ?? providerSettings.apiLine)
	assignIfDefined(merged, "headers", stateConfig.headers ?? providerSettings.headers)
	assignIfDefined(merged, "region", stateConfig.region ?? providerSettings.region)
	assignIfDefined(merged, "auth", stateConfig.auth ?? providerSettings.auth)
	assignIfDefined(merged, "extras", mergeExtras(providerSettings.extras, stateConfig.extras))

	return { providerId, ...merged }
}
