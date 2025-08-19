import { rooDefaultModelId, rooModels, type RooModelId } from "@roo-code/types"
import { CloudService } from "@roo-code/cloud"

import type { ApiHandlerOptions } from "../../shared/api"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { t } from "../../i18n"

export class RooHandler extends BaseOpenAiCompatibleProvider<RooModelId> {
	constructor(options: ApiHandlerOptions) {
		// Check if CloudService is available and get the session token.
		if (!CloudService.hasInstance()) {
			throw new Error(t("common:errors.roo.authenticationRequired"))
		}

		const sessionToken = CloudService.instance.authService?.getSessionToken()

		if (!sessionToken) {
			throw new Error(t("common:errors.roo.authenticationRequired"))
		}

		super({
			...options,
			providerName: "Roo Code Cloud",
			baseURL: "https://api.roocode.com/proxy/v1",
			apiKey: sessionToken,
			defaultProviderModelId: rooDefaultModelId,
			providerModels: rooModels,
			defaultTemperature: 0.7,
		})
	}

	override getModel() {
		const modelId = this.options.apiModelId || rooDefaultModelId
		const modelInfo = this.providerModels[modelId as RooModelId] ?? this.providerModels[rooDefaultModelId]

		if (modelInfo) {
			return { id: modelId as RooModelId, info: modelInfo }
		}

		// Return the requested model ID even if not found, with fallback info.
		return {
			id: modelId as RooModelId,
			info: {
				maxTokens: 8192,
				contextWindow: 262_144,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
			},
		}
	}
}
