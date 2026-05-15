import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import type { Mode, ProviderConfigStore, ProviderId } from "@/sdk/model-catalog/contracts"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ApiConfiguration, ApiProvider } from "@/shared/api"
import { isMigratedSdkProvider } from "@/shared/model-catalog/provider-helpers"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"

type ProviderSwitchConfig = Partial<
	Pick<ApiConfiguration, "planModeApiProvider" | "actModeApiProvider" | "planModeApiModelId" | "actModeApiModelId">
>

const modeFields = {
	plan: {
		provider: "planModeApiProvider",
		modelId: "planModeApiModelId",
	},
	act: {
		provider: "actModeApiProvider",
		modelId: "actModeApiModelId",
	},
} as const

function toProviderId(provider: ApiProvider | string | undefined): ProviderId | undefined {
	const trimmed = provider?.trim()
	return trimmed ? parseProviderId(trimmed) : undefined
}

function resolveProviderSwitchModelId(
	store: ProviderConfigStore,
	providerId: ProviderId,
	mode: Mode,
	currentModelId: string | undefined,
): string {
	const generatedModels = getGeneratedModelsForProvider(providerId)
	const collection = MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]
	const collectionModels = collection?.models ?? {}
	if (currentModelId && (generatedModels[currentModelId] || collectionModels[currentModelId])) {
		return currentModelId
	}

	const selection = store.readSelection(providerId, mode)
	if (selection?.modelId) {
		return selection.modelId
	}

	const sdkDefaultModelId = collection?.provider.defaultModelId?.trim()
	if (sdkDefaultModelId && (generatedModels[sdkDefaultModelId] || collectionModels[sdkDefaultModelId])) {
		return sdkDefaultModelId
	}

	return Object.keys(generatedModels)[0] || Object.keys(collectionModels)[0] || ""
}

/**
 * Keep generic legacy model-id slots coherent when switching to an SDK-catalog
 * provider. DeepSeek currently stores its model id in `*ModeApiModelId`; without
 * this normalization, switching Anthropic/Cline/etc. → DeepSeek can leave the
 * generic slot pointing at a previous provider's model.
 */
export function normalizeProviderSwitchModel<T extends ProviderSwitchConfig>(
	store: ProviderConfigStore,
	previous: ProviderSwitchConfig,
	next: T,
): T {
	const normalized: ProviderSwitchConfig = { ...next }

	for (const [mode, fields] of Object.entries(modeFields) as [Mode, (typeof modeFields)[Mode]][]) {
		const previousProvider = previous[fields.provider]
		const nextProvider = (normalized[fields.provider] ?? previousProvider) as ApiProvider | undefined
		if (!nextProvider || nextProvider === previousProvider) {
			continue
		}

		const providerId = toProviderId(nextProvider)
		if (!providerId || !isMigratedSdkProvider(providerId)) {
			continue
		}

		const genericModelKey = getProviderModelIdKey(nextProvider, mode)
		if (genericModelKey !== fields.modelId) {
			continue
		}

		const currentModelId = (normalized[fields.modelId] ?? previous[fields.modelId]) as string | undefined
		const resolvedModelId = resolveProviderSwitchModelId(store, providerId, mode, currentModelId)
		if (resolvedModelId) {
			normalized[fields.modelId] = resolvedModelId
		}
	}

	return normalized as T
}
