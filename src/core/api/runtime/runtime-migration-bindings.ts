import type { ApiConfiguration, ApiProvider, RuntimeId } from "@shared/api"
import { FUTURE_RUNTIME_IDS, getLegacyProviderForRuntimeId, isFutureRuntimeId } from "@shared/api"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@shared/storage/provider-keys"
import type { SecretKey, SettingsKey } from "@shared/storage/state-keys"
import type { RuntimeMigrationBinding } from "./persistence-types"

const runtimeSpecificSettingKeys: Partial<Record<ApiProvider, SettingsKey[]>> = {
	"claude-code": ["claudeCodePath"],
	"kiro-cli": ["kiroCliPath"],
	openai: ["openAiBaseUrl"],
	ollama: ["ollamaBaseUrl", "ollamaApiOptionsCtxNum"],
	lmstudio: ["lmStudioBaseUrl", "lmStudioMaxTokens"],
	gemini: ["geminiBaseUrl", "vertexProjectId", "vertexRegion"],
	vertex: ["vertexProjectId", "vertexRegion", "geminiBaseUrl"],
	bedrock: [
		"awsRegion",
		"awsAuthentication",
		"awsUseProfile",
		"awsProfile",
		"awsBedrockEndpoint",
		"awsUseCrossRegionInference",
		"awsUseGlobalInference",
		"awsBedrockUsePromptCache",
	],
	requesty: ["requestyBaseUrl"],
	"qwen-code": ["qwenCodeOauthPath"],
	asksage: ["asksageApiUrl"],
	moonshot: ["moonshotApiLine"],
	qwen: ["qwenApiLine"],
	zai: ["zaiApiLine"],
	minimax: ["minimaxApiLine"],
	dify: ["difyBaseUrl"],
	oca: ["ocaBaseUrl", "ocaMode"],
	aihubmix: ["aihubmixBaseUrl", "aihubmixAppCode"],
	litellm: ["liteLlmBaseUrl", "liteLlmUsePromptCache"],
	"huawei-cloud-maas": [],
	hicap: [],
} as const

const genericSettingKeys: SettingsKey[] = [
	"actModeApiProvider",
	"planModeApiProvider",
	"actModeApiModelId",
	"planModeApiModelId",
	"actModeReasoningEffort",
	"planModeReasoningEffort",
	"actModeThinkingBudgetTokens",
	"planModeThinkingBudgetTokens",
	"requestTimeoutMs",
]

const providerSecretKeys = (provider: ApiProvider): SecretKey[] => {
	const keyField = ProviderToApiKeyMap[provider]
	if (!keyField) {
		return []
	}

	return (Array.isArray(keyField) ? keyField : [keyField]) as SecretKey[]
}

const dedupe = <T>(values: T[]): T[] => Array.from(new Set(values))

export const createRuntimeMigrationBinding = (runtimeId: RuntimeId): RuntimeMigrationBinding => {
	if (isFutureRuntimeId(runtimeId)) {
		return {
			runtimeId,
			settingKeys: genericSettingKeys,
			secretKeys: [],
			protoCompatibilityMode: "runtime-aware",
			uiCompatibilityMode: "runtime-aware",
		}
	}

	const legacyProvider = getLegacyProviderForRuntimeId(runtimeId)
	if (!legacyProvider) {
		throw new Error(`Runtime ${runtimeId} does not have a legacy provider binding`)
	}

	return {
		runtimeId,
		legacyProvider,
		settingKeys: dedupe([
			...genericSettingKeys,
			getProviderModelIdKey(legacyProvider, "act"),
			getProviderModelIdKey(legacyProvider, "plan"),
			...(runtimeSpecificSettingKeys[legacyProvider] ?? []),
		]),
		secretKeys: providerSecretKeys(legacyProvider),
		protoCompatibilityMode: "legacy-provider",
		uiCompatibilityMode: "legacy-provider",
	}
}

const futureBindings = FUTURE_RUNTIME_IDS.map((runtimeId) => createRuntimeMigrationBinding(runtimeId))

export const getRuntimeMigrationBinding = (runtimeId: RuntimeId): RuntimeMigrationBinding =>
	isFutureRuntimeId(runtimeId)
		? futureBindings.find((binding) => binding.runtimeId === runtimeId)!
		: createRuntimeMigrationBinding(runtimeId)

export const getRuntimeSettingKeys = (runtimeId: RuntimeId): SettingsKey[] => getRuntimeMigrationBinding(runtimeId).settingKeys

export const getRuntimeSecretKeys = (runtimeId: RuntimeId): SecretKey[] => getRuntimeMigrationBinding(runtimeId).secretKeys

export const applyRuntimeMutationToApiConfiguration = (
	apiConfiguration: Partial<ApiConfiguration>,
	runtimeId: RuntimeId,
): Partial<ApiConfiguration> => {
	const binding = getRuntimeMigrationBinding(runtimeId)

	if (binding.legacyProvider) {
		return {
			...apiConfiguration,
			actModeApiProvider: binding.legacyProvider,
			planModeApiProvider: binding.legacyProvider,
		}
	}

	return { ...apiConfiguration }
}
