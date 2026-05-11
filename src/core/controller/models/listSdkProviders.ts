import { EmptyRequest } from "@shared/proto/cline/common"
import { ProviderCatalogResponse } from "@shared/proto/cline/models"
import { listSdkProviderCatalog } from "@/sdk/sdk-provider-settings-service"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Lists providers from the SDK provider catalog.
 *
 * This is the bridge used by the webview settings UI while provider selection
 * migrates from the legacy @shared/providers/providers.json list to the SDK's
 * dynamic provider registry.
 */
export async function listSdkProviders(_controller: Controller, _request: EmptyRequest): Promise<ProviderCatalogResponse> {
	try {
		const result = await listSdkProviderCatalog()

		return ProviderCatalogResponse.create({
			settingsPath: result.settingsPath,
			providers: result.providers.map((provider) => ({
				id: provider.id,
				name: provider.name,
				models: provider.models ?? undefined,
				enabled: provider.enabled,
				apiKey: provider.apiKey,
				oauthAccessTokenPresent: provider.oauthAccessTokenPresent,
				baseUrl: provider.baseUrl,
				defaultModelId: provider.defaultModelId,
				protocol: provider.protocol,
				client: provider.client,
				authDescription: provider.authDescription,
				baseUrlDescription: provider.baseUrlDescription,
				family: provider.family,
				modelList: provider.modelList?.map((model) => ({
					id: model.id,
					name: model.name,
					supportsAttachments: model.supportsAttachments,
					supportsVision: model.supportsVision,
					supportsReasoning: model.supportsReasoning,
				})),
			})),
		})
	} catch (error) {
		Logger.error(`[listSdkProviders] Failed to list SDK providers: ${error}`)
		throw error
	}
}
