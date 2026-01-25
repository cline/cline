import { OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "./api"

// SKAX Models
export type SkaxModelId = keyof typeof skaxModels
export const skaxDefaultModelId: SkaxModelId = "ax4"
export const skaxModels = {
	ax4: {
		...openAiModelInfoSaneDefaults,
		maxTokens: -1,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "SKAX AX4 model",
	},
} as const satisfies Record<string, OpenAiCompatibleModelInfo>
