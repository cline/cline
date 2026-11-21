import { readModelsFileSync, resolveModelsRegistryPath, writeModelsFileSync } from "@cline/core"
import { unregisterProvider } from "@cline/llms"
import { getProviderSettingsManager } from "@/sdk/provider-migration"
import { Empty, StringRequest } from "@/shared/proto/cline/common"
import {
	hasProviderCatalogStateController,
	type ProviderCatalogController,
	parseProviderIdRequest,
} from "./providerCatalogShared"

export async function deleteOpenAiCompatibleProvider(
	controller: ProviderCatalogController,
	request: StringRequest,
): Promise<Empty> {
	const id = parseProviderIdRequest(request.value ?? "")
	if (!id.startsWith("custom-openai-")) throw new Error("Only custom OpenAI Compatible providers can be deleted.")
	const manager = getProviderSettingsManager()
	const modelsPath = resolveModelsRegistryPath(manager)
	const models = readModelsFileSync(modelsPath)
	delete models.providers[id]
	writeModelsFileSync(modelsPath, models)
	const settings = manager.read()
	delete settings.providers[id]
	if (settings.lastUsedProvider === id) delete settings.lastUsedProvider
	if (settings.modes?.voiceInput?.providerId === id) delete settings.modes.voiceInput
	manager.write(settings)
	unregisterProvider(id)
	controller.getProviderCatalog().invalidateProviderListings()
	if (hasProviderCatalogStateController(controller)) {
		const previous = controller.stateManager.getApiConfiguration?.() ?? {}
		const updates: Record<string, unknown> = {}
		for (const mode of ["plan", "act"] as const) {
			if (previous[`${mode}ModeApiProvider`] === id) {
				updates[`${mode}ModeApiProvider`] = "openai"
				updates[`${mode}ModeApiModelId`] = undefined
			}
		}
		controller.stateManager.setGlobalStateBatch(updates)
		await controller.stateManager.flushPendingState?.()
		const next = controller.stateManager.getApiConfiguration?.()
		if (next) controller.handleApiConfigurationChanged?.(previous, next)
		await controller.postStateToWebview?.()
	}
	return Empty.create()
}
