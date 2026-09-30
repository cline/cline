import { loginAndSaveProviderOAuthCredentials } from "@cline/core"
import type { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { getProviderSettingsManager } from "@/sdk/provider-migration"
import type { Controller } from ".."

export async function chatGptPlanSignIn(controller: Controller, _: EmptyRequest): Promise<Empty> {
	await loginAndSaveProviderOAuthCredentials(getProviderSettingsManager(), "openai-chatgpt", {
		callbacks: {
			onAuth: async ({ url }) => {
				await HostProvider.env.openExternal({ value: url })
			},
			onPrompt: async () => "",
		},
	})
	const providerId = parseProviderId("openai-chatgpt")
	controller.getProviderConfigStore().write(providerId, {})
	await controller.getProviderCatalog().resolveModels(providerId, { forceRefresh: true })
	await controller.postStateToWebview()
	return {}
}
