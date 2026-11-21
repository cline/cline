import { randomUUID } from "node:crypto"
import { readModelsFileSync, resolveModelsRegistryPath, syncStoredProviderRegistration, writeModelsFileSync } from "@cline/core"
import { getProviderSettingsManager } from "@/sdk/provider-migration"
import { CreateOpenAiCompatibleProviderRequest, ProviderListing } from "@/shared/proto/cline/models"
import { type ProviderCatalogController, parseProviderIdRequest } from "./providerCatalogShared"

export async function createOpenAiCompatibleProvider(
	controller: ProviderCatalogController,
	request: CreateOpenAiCompatibleProviderRequest,
): Promise<ProviderListing> {
	const name = request.name.trim()
	if (!name || name.length > 100) {
		throw new Error("Provider name must contain between 1 and 100 characters.")
	}
	const baseUrl = request.baseUrl.trim()
	let url: URL
	try {
		url = new URL(baseUrl)
	} catch {
		throw new Error("Enter a valid HTTP or HTTPS base URL.")
	}
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new Error("Enter a valid HTTP or HTTPS base URL.")
	}
	const catalog = controller.getProviderCatalog()
	const providers = await catalog.listProviders()
	if (providers.some((provider) => provider.name.toLowerCase() === name.toLowerCase())) {
		throw new Error("A provider with this name already exists. Choose a different name.")
	}
	const id = parseProviderIdRequest(`custom-openai-${randomUUID()}`)
	const modelsPath = resolveModelsRegistryPath(getProviderSettingsManager())
	const state = readModelsFileSync(modelsPath)
	const entry = { provider: { name, baseUrl, protocol: "openai-chat" as const }, models: {} }
	writeModelsFileSync(modelsPath, { ...state, providers: { ...state.providers, [id]: entry } })
	syncStoredProviderRegistration(id, undefined, entry)
	controller.getProviderConfigStore().write(id, { baseUrl })
	catalog.invalidateProviderListings()
	return ProviderListing.create({ id, name, protocol: "openai-chat", allowsCustomModelIds: true, usageCostDisplay: "show" })
}
