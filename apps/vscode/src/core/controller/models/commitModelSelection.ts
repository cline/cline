import type { ModelSelection, ProviderId } from "@/sdk/model-catalog/contracts"
import { openAiModelInfoSafeDefaults } from "@/shared/api"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { Empty } from "@/shared/proto/cline/common"
import { CommitModelSelectionRequest } from "@/shared/proto/cline/models"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import {
	hasProviderCatalogStateController,
	type ProviderCatalogController,
	parseModeRequest,
	parseProviderIdRequest,
	toModelSelection,
} from "./providerCatalogShared"

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readRemoteAllowedModelIds(controller: ProviderCatalogController, providerId: ProviderId): readonly string[] {
	const remoteConfigSettings = (
		controller as { stateManager?: { getRemoteConfigSettings?: () => unknown } }
	).stateManager?.getRemoteConfigSettings?.()
	if (!isRecord(remoteConfigSettings) || !isRecord(remoteConfigSettings.remoteProviderModelSettings)) {
		return []
	}

	const settings = remoteConfigSettings.remoteProviderModelSettings[providerId.toString()]
	if (!isRecord(settings)) {
		return []
	}

	const models = Array.isArray(settings.models) ? settings.models : []
	const bedrockCustomModels = Array.isArray(settings.bedrockCustomModels) ? settings.bedrockCustomModels : []
	return [
		...models.map((model) => (isRecord(model) && typeof model.id === "string" ? model.id : "")),
		...bedrockCustomModels.map((model) => (isRecord(model) && typeof model.name === "string" ? model.name : "")),
	].filter((modelId) => modelId.trim().length > 0)
}

async function coerceSelectionToRemoteAllowlist(
	controller: ProviderCatalogController,
	providerId: ProviderId,
	selection: ModelSelection,
): Promise<ModelSelection> {
	const allowedModelIds = readRemoteAllowedModelIds(controller, providerId)
	if (allowedModelIds.length === 0 || allowedModelIds.includes(selection.modelId)) {
		return selection
	}

	const modelId = allowedModelIds[0]
	const cachedModels = controller.getProviderCatalog().peekModels(providerId)
	const resolvedModels = cachedModels?.ok ? cachedModels : await controller.getProviderCatalog().resolveModels(providerId)
	const modelInfo =
		resolvedModels.ok && resolvedModels.models.has(modelId)
			? resolvedModels.models.get(modelId)
			: { ...openAiModelInfoSafeDefaults, name: modelId }

	return {
		providerId,
		modelId,
		modelInfo: modelInfo ?? { ...openAiModelInfoSafeDefaults, name: modelId },
	}
}

async function enrichSelectionFromCatalog(
	controller: ProviderCatalogController,
	providerId: ProviderId,
	selection: ModelSelection,
): Promise<{ selection: ModelSelection; modelWasLoaded: boolean }> {
	const cachedModels = controller.getProviderCatalog().peekModels(providerId)
	const resolvedModels = cachedModels?.ok
		? cachedModels
		: await Promise.resolve(controller.getProviderCatalog().resolveModels(providerId)).catch(() => undefined)
	if (!resolvedModels?.ok) {
		return { selection, modelWasLoaded: false }
	}

	const modelInfo = resolvedModels.models.get(selection.modelId)
	if (!modelInfo) {
		return { selection, modelWasLoaded: false }
	}

	return {
		selection: {
			...selection,
			modelInfo,
		},
		modelWasLoaded: true,
	}
}

function readSapDeploymentId(modelInfo: ModelSelection["modelInfo"]): string | undefined {
	const metadata = (modelInfo as ModelSelection["modelInfo"] & { metadata?: Record<string, unknown> }).metadata
	const sap = metadata?.sap
	if (!sap || typeof sap !== "object" || Array.isArray(sap)) {
		return undefined
	}
	const deploymentId = (sap as Record<string, unknown>).deploymentId
	return typeof deploymentId === "string" && deploymentId.trim().length > 0 ? deploymentId.trim() : undefined
}

export async function commitModelSelection(
	controller: ProviderCatalogController,
	request: CommitModelSelectionRequest,
): Promise<Empty> {
	const providerId = parseProviderIdRequest(request.providerId)
	const mode = parseModeRequest(request.mode)
	const coercedSelection = await coerceSelectionToRemoteAllowlist(controller, providerId, toModelSelection(request, providerId))
	const { selection, modelWasLoaded } = await enrichSelectionFromCatalog(controller, providerId, coercedSelection)
	const previousApiConfiguration = hasProviderCatalogStateController(controller)
		? controller.stateManager.getApiConfiguration?.()
		: undefined
	const store = controller.getProviderConfigStore()
	if (providerId.toString() === "sapaicore" && modelWasLoaded) {
		store.write(providerId, { mode, sap: { deploymentId: readSapDeploymentId(selection.modelInfo) ?? "" } })
	}
	store.commitSelection(providerId, mode, selection)

	if (hasProviderCatalogStateController(controller)) {
		const legacyProviderId = toLegacyApiProvider(providerId.toString())
		controller.stateManager.setGlobalStateBatch({
			planModeApiProvider: legacyProviderId,
			actModeApiProvider: legacyProviderId,
			[getProviderModelIdKey(legacyProviderId, "plan")]: selection.modelId,
			[getProviderModelIdKey(legacyProviderId, "act")]: selection.modelId,
		})
		const nextApiConfiguration = controller.stateManager.getApiConfiguration?.()
		if (nextApiConfiguration) {
			controller.handleApiConfigurationChanged?.(previousApiConfiguration ?? {}, nextApiConfiguration)
		}
		await controller.postStateToWebview?.()
	}

	return Empty.create()
}
