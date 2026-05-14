import type { ApiConfiguration, ModelInfo } from "@shared/api"
import type {
	EffectiveProviderConfig,
	Mode,
	ModelSelection,
	ProviderCatalog,
	ProviderConfigPatch,
	ProviderConfigStore,
	ProviderId,
	ProviderListing,
	ProviderModelsResult,
} from "@/sdk/model-catalog/contracts"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import {
	CatalogErrorInfo,
	CommitModelSelectionRequest,
	CommittedModelSelection,
	OpenRouterModelInfo,
	ProviderConfigResponse,
	ProviderListing as ProviderListingProto,
	ProviderModelsResponse,
	WriteProviderConfigPatch,
} from "@/shared/proto/cline/models"
import { fromProtobufModelInfo, toProtobufModelInfo } from "@/shared/proto-conversions/models/typeConversion"
import type { GlobalStateAndSettings } from "@/shared/storage/state-keys"

export interface ProviderCatalogController {
	getProviderConfigStore(): ProviderConfigStore
	getProviderCatalog(): ProviderCatalog
}

export interface ProviderCatalogStateController extends ProviderCatalogController {
	stateManager: {
		setGlobalStateBatch(updates: Partial<GlobalStateAndSettings>): void
		getApiConfiguration?(): ApiConfiguration
	}
}

export function hasProviderCatalogStateController(
	controller: ProviderCatalogController,
): controller is ProviderCatalogStateController {
	const candidate = controller as { stateManager?: { setGlobalStateBatch?: unknown } }
	return typeof candidate.stateManager?.setGlobalStateBatch === "function"
}

export function parseProviderIdRequest(rawProviderId: string | undefined, fieldName = "provider_id"): ProviderId {
	const providerId = rawProviderId?.trim()
	if (!providerId) {
		throw new Error(`${fieldName} is required`)
	}
	return parseProviderId(providerId)
}

export function parseModeRequest(rawMode: string | undefined): Mode {
	if (rawMode === "plan" || rawMode === "act") {
		return rawMode
	}
	throw new Error('mode must be "plan" or "act"')
}

export function toProviderListingProto(listing: ProviderListing): ProviderListingProto {
	return ProviderListingProto.create({
		id: listing.id,
		name: listing.name,
		defaultModelId: listing.defaultModelId,
		family: listing.family,
		protocol: listing.protocol,
		authDescription: listing.authDescription,
		baseUrlDescription: listing.baseUrlDescription,
		allowsCustomModelIds: listing.allowsCustomModelIds,
	})
}

type ProviderModelsError = Extract<ProviderModelsResult, { ok: false }>["error"]

function toCatalogErrorInfo(error: ProviderModelsError): CatalogErrorInfo {
	return CatalogErrorInfo.create({
		kind: error.kind,
		message: error.message,
		code: error.code,
	})
}

function toProtobufModels(models: ReadonlyMap<string, ModelInfo>): Record<string, OpenRouterModelInfo> {
	const result: Record<string, OpenRouterModelInfo> = {}
	for (const [modelId, modelInfo] of models) {
		result[modelId] = toProtobufModelInfo(modelInfo)
	}
	return result
}

function toCommittedModelSelectionProto(selection: ModelSelection | undefined): CommittedModelSelection | undefined {
	if (!selection) {
		return undefined
	}
	return CommittedModelSelection.create({
		providerId: selection.providerId,
		modelId: selection.modelId,
		modelInfo: toProtobufModelInfo(selection.modelInfo),
	})
}

export function toProviderModelsResponse(
	providerId: ProviderId,
	requestId: string,
	result: ProviderModelsResult,
): ProviderModelsResponse {
	return ProviderModelsResponse.create({
		providerId,
		requestId,
		configFingerprint: result.configFingerprint,
		fetchedAt: result.fetchedAt,
		ok: result.ok,
		models: result.ok ? toProtobufModels(result.models) : {},
		defaultModelId: result.ok ? result.defaultModelId : undefined,
		source: result.ok ? result.source : undefined,
		error: result.ok ? undefined : toCatalogErrorInfo(result.error),
	})
}

export function toRedactedProviderConfigResponse(
	config: EffectiveProviderConfig,
	store?: ProviderConfigStore,
): ProviderConfigResponse {
	return ProviderConfigResponse.create({
		providerId: config.providerId,
		baseUrl: config.baseUrl,
		apiLine: config.apiLine,
		headers: config.headers ?? {},
		region: config.region,
		hasApiKey: Boolean(config.apiKey),
		hasAccessToken: Boolean(config.auth?.accessToken),
		hasRefreshToken: Boolean(config.auth?.refreshToken),
		accountId: config.auth?.accountId,
		planSelection: toCommittedModelSelectionProto(store?.readSelection(config.providerId, "plan")),
		actSelection: toCommittedModelSelectionProto(store?.readSelection(config.providerId, "act")),
	})
}

export function toProviderConfigPatch(protoPatch: WriteProviderConfigPatch | undefined): ProviderConfigPatch {
	if (!protoPatch) {
		throw new Error("patch is required")
	}
	return {
		...(protoPatch.apiKey !== undefined ? { apiKey: protoPatch.apiKey } : {}),
		...(protoPatch.baseUrl !== undefined ? { baseUrl: protoPatch.baseUrl } : {}),
		...(Object.keys(protoPatch.headers).length > 0 ? { headers: { ...protoPatch.headers } } : {}),
		...(protoPatch.region !== undefined ? { region: protoPatch.region } : {}),
		...(protoPatch.apiLine !== undefined ? { apiLine: protoPatch.apiLine } : {}),
		...(protoPatch.accessToken !== undefined || protoPatch.refreshToken !== undefined || protoPatch.accountId !== undefined
			? {
					auth: {
						accessToken: protoPatch.accessToken,
						refreshToken: protoPatch.refreshToken,
						accountId: protoPatch.accountId,
					},
				}
			: {}),
	}
}

export function toModelSelection(request: CommitModelSelectionRequest, providerId: ProviderId): ModelSelection {
	const modelId = request.modelId.trim()
	if (!modelId) {
		throw new Error("model_id is required")
	}
	if (!request.modelInfo) {
		throw new Error("model_info is required")
	}
	return {
		providerId,
		modelId,
		modelInfo: fromProtobufModelInfo(request.modelInfo),
	}
}
