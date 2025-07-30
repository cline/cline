import { type SambaNovaModelId, sambaNovaDefaultModelId, sambaNovaModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class SambaNovaHandler extends BaseOpenAiCompatibleProvider<SambaNovaModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "SambaNova",
			baseURL: "https://api.sambanova.ai/v1",
			apiKey: options.sambaNovaApiKey,
			defaultProviderModelId: sambaNovaDefaultModelId,
			providerModels: sambaNovaModels,
			defaultTemperature: 0.7,
		})
	}
}
