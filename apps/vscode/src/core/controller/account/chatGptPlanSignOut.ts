import type { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { getProviderSettingsManager } from "@/sdk/provider-migration"
import type { Controller } from ".."

export async function chatGptPlanSignOut(controller: Controller, _: EmptyRequest): Promise<Empty> {
	const manager = getProviderSettingsManager()
	const settings = manager.getProviderSettings("openai-chatgpt")
	if (settings) manager.saveProviderSettings({ ...settings, auth: undefined, apiKey: undefined }, { setLastUsed: false })
	controller.getProviderConfigStore().write(parseProviderId("openai-chatgpt"), {})
	await controller.postStateToWebview()
	return {}
}
